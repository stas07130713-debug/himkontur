import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseHydrantActDocx, parseHydrantActTables, parseHydrantActText } from './hydrant-act-import';

describe('hydrant act import', () => {
  const suppliedActPath = process.env.HYDRANT_ACT_SAMPLE;
  (suppliedActPath === undefined ? it.skip : it)('reads every row of an optionally supplied real inspection act', async () => {
    const file = await readFile(suppliedActPath ?? '');
    const result = await parseHydrantActDocx(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    const counts = result.rows.reduce<Record<string, number>>((current, row) => ({ ...current, [row.status]: (current[row.status] ?? 0) + 1 }), {});
    expect(result.rows).toHaveLength(158);
    expect(new Set(result.rows.map((row) => row.number)).size).toBe(158);
    expect(counts).toMatchObject({ serviceable: 147, faulty: 8, unknown: 3 });
    expect(result.rows.find((row) => row.number === '53')).toMatchObject({ networkLabel: 'К-200', pressureLabel: '7,5', status: 'serviceable' });
    expect(result.rows.find((row) => row.number === '7')).toMatchObject({ networkLabel: 'К-300', status: 'faulty' });
    expect(result.rows.find((row) => row.number === '182')).toMatchObject({ networkLabel: 'К-150', status: 'unknown' });
  });

  it('reads statuses and defect descriptions from the act table without guessing', () => {
    const rows = parseHydrantActTables([[
      ['Транспортный цех'],
      ['', '53', 'К-200', '7,5', 'Исправен', '', ''],
      ['', '43', 'Т-200', '---', 'Неисправен', 'Отсутствует вода для нужд пожаротушения.', 'Провести ревизию.'],
      ['', '182', 'К-150', '---', 'Не проверен', 'Завален грунтом.', 'Установить местонахождение.'],
    ]]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ number: '53', status: 'serviceable', owner: 'Транспортный цех' });
    expect(rows[1]).toMatchObject({ number: '43', status: 'faulty', faultDescription: 'Отсутствует вода для нужд пожаротушения.' });
    expect(rows[2]).toMatchObject({ number: '182', status: 'unknown', faultDescription: 'Завален грунтом.' });
  });

  it('reads the supplied Word table structure and inspection period from DOCX XML', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:r><w:t>Проверка проведена в период с 01.06.2026 по 01.07.2026</w:t></w:r></w:p>
        <w:tbl>
          <w:tr><w:tc><w:p><w:r><w:t>Химико-металлургический цех</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr>
            <w:tc><w:p /></w:tc><w:tc><w:p><w:r><w:t>119</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>К-400</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7,5</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>Исправен</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Вода в колодце.</w:t></w:r></w:p></w:tc>
            <w:tc><w:p><w:r><w:t>Откачать воду.</w:t></w:r></w:p></w:tc>
          </w:tr>
        </w:tbl>
      </w:body></w:document>`);
    const result = await parseHydrantActDocx(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(result.inspectionDate).toBe('2026-07-01');
    expect(result.rows).toEqual([expect.objectContaining({
      number: '119',
      status: 'serviceable',
      networkLabel: 'К-400',
      pressureLabel: '7,5',
      faultDescription: 'Вода в колодце.',
      owner: 'Химико-металлургический цех',
    })]);
  });

  it('keeps reading all hydrant rows when Word inserts a nested service table', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:tbl>
          <w:tr><w:tc><w:p><w:r><w:t>№ п/п</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>№ ПГ</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Сеть, диаметр</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Р, атм. в ПГ</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Состояние гидранта</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Причина неисправности</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Мероприятия по устранению</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>53</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>К-200</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7,5</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Исправен</w:t></w:r></w:p></w:tc><w:tc><w:p /></w:tc><w:tc><w:p /></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>служебная ячейка</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>вложенная таблица</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>К-300</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>---</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Неисправен</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Колонка не накручивается.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ремонт.</w:t></w:r></w:p></w:tc></w:tr>
          <w:tr><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>182</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>К-150</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>---</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Не проверен</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Завален грунтом.</w:t></w:r></w:p></w:tc><w:tc><w:p /></w:tc></w:tr>
        </w:tbl>
      </w:body></w:document>`);
    const result = await parseHydrantActDocx(await zip.generateAsync({ type: 'arraybuffer' }));

    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.number)).toEqual(['53', '7', '182']);
    expect(result.rows[0]).toMatchObject({ networkLabel: 'К-200', pressureLabel: '7,5', status: 'serviceable' });
    expect(result.rows[1]).toMatchObject({ status: 'faulty', faultDescription: 'Колонка не накручивается.' });
    expect(result.rows[2]).toMatchObject({ status: 'unknown', faultDescription: 'Завален грунтом.' });
  });

  it('keeps not-checked hydrants unknown in delimited text imports', () => {
    const result = parseHydrantActText('Номер;Состояние;Причина неисправности\nПГ-7;Не проверен;Завален грунтом');
    expect(result.rows[0]).toMatchObject({ number: '7', status: 'unknown', faultDescription: 'Завален грунтом' });
  });

  it('keeps hydrants with unspecified state unknown', () => {
    for (const state of ['Неизвестно', 'Не установлено', 'Не заполнено', 'Нет данных']) {
      const result = parseHydrantActText(`Номер;Состояние;Причина неисправности\nПГ-7;${state};`);
      expect(result.rows[0]).toMatchObject({ number: '7', status: 'unknown' });
    }
  });
});
