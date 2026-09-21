export type OcrCandidate = Readonly<{ canvas: HTMLCanvasElement; label: string; region: number; row: 'upper' | 'lower' | 'whole' | 'fallback' }>;

type Rectangle = Readonly<{ x: number; y: number; width: number; height: number; score: number }>;

function orangePixel(red: number, green: number, blue: number): boolean {
  return red > 125 && green > 42 && green < 190 && blue < 125 && red > green * 1.18 && green > red * .32 && green > blue * .82;
}

function orangeRectangles(image: ImageData): readonly Rectangle[] {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    if (orangePixel(data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0)) mask[index] = 1;
  }
  const visited = new Uint8Array(mask.length);
  const rectangles: Rectangle[] = [];
  const queue = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] === 1) continue;
    let head = 0; let tail = 0; let count = 0;
    let minX = width; let minY = height; let maxX = 0; let maxY = 0;
    queue[tail++] = start; visited[start] = 1;
    while (head < tail) {
      const current = queue[head++] ?? 0; const x = current % width; const y = Math.floor(current / width); count += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      const neighbours = [current - 1, current + 1, current - width, current + width];
      for (const next of neighbours) {
        if (next < 0 || next >= mask.length || mask[next] === 0 || visited[next] === 1) continue;
        const nextX = next % width;
        if (Math.abs(nextX - x) > 1) continue;
        visited[next] = 1; queue[tail++] = next;
      }
    }
    const boxWidth = maxX - minX + 1; const boxHeight = maxY - minY + 1; const boxArea = boxWidth * boxHeight; const imageArea = width * height;
    const ratio = boxWidth / Math.max(1, boxHeight); const relativeArea = boxArea / imageArea; const density = count / boxArea;
    if (boxWidth < 12 || boxHeight < 7 || ratio < .55 || ratio > 4.5 || relativeArea < .00008 || relativeArea > .16 || density < .08) continue;
    const sizeScore = Math.min(1, relativeArea / .012);
    rectangles.push({ x: minX, y: minY, width: boxWidth, height: boxHeight, score: density * (.8 + sizeScore) });
  }
  return rectangles.sort((left, right) => right.score - left.score).slice(0, 16);
}

function stackedPlacards(rectangles: readonly Rectangle[]): readonly Rectangle[] {
  const merged: Rectangle[] = [];
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
    const left = rectangles[leftIndex]; const right = rectangles[rightIndex];
    if (left === undefined || right === undefined) continue;
    const upper = left.y <= right.y ? left : right; const lower = upper === left ? right : left;
    const overlap = Math.max(0, Math.min(upper.x + upper.width, lower.x + lower.width) - Math.max(upper.x, lower.x));
    const horizontalMatch = overlap / Math.max(1, Math.min(upper.width, lower.width));
    const centreDifference = Math.abs((upper.x + upper.width / 2) - (lower.x + lower.width / 2));
    const verticalGap = lower.y - (upper.y + upper.height);
    if (horizontalMatch < .72 || centreDifference > Math.max(upper.width, lower.width) * .22 || verticalGap < -Math.min(upper.height, lower.height) * .2 || verticalGap > Math.max(upper.height, lower.height) * .65) continue;
    const x = Math.min(upper.x, lower.x); const y = upper.y;
    const width = Math.max(upper.x + upper.width, lower.x + lower.width) - x;
    const height = lower.y + lower.height - y;
    const ratio = width / Math.max(1, height);
    if (ratio < .65 || ratio > 2.8) continue;
    merged.push({ x, y, width, height, score: (upper.score + lower.score) / 2 + .35 });
  }
  return merged;
}

function otsuThreshold(pixels: ImageData): number {
  const histogram = new Uint32Array(256);
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const luminance = Math.round((pixels.data[offset] ?? 0) * .299 + (pixels.data[offset + 1] ?? 0) * .587 + (pixels.data[offset + 2] ?? 0) * .114);
    histogram[luminance] = (histogram[luminance] ?? 0) + 1;
  }
  const total = pixels.width * pixels.height;
  let totalSum = 0;
  for (let value = 0; value < 256; value += 1) totalSum += value * (histogram[value] ?? 0);
  let backgroundWeight = 0; let backgroundSum = 0; let bestVariance = -1; let best = 128;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value] ?? 0;
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;
    backgroundSum += value * (histogram[value] ?? 0);
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) { bestVariance = variance; best = value; }
  }
  return best;
}

function cropCandidate(bitmap: ImageBitmap, rectangle: Rectangle, label: string, region: number, row: OcrCandidate['row'], thresholdOffset?: number): OcrCandidate {
  const marginX = rectangle.width * .03; const marginY = rectangle.height * .08;
  const sourceX = Math.max(0, rectangle.x - marginX); const sourceY = Math.max(0, rectangle.y - marginY);
  const sourceWidth = Math.min(bitmap.width - sourceX, rectangle.width + marginX * 2); const sourceHeight = Math.min(bitmap.height - sourceY, rectangle.height + marginY * 2);
  const scale = Math.min(12, Math.max(2, 1200 / Math.max(sourceWidth, 1)));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return { canvas, label, region, row };
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  if (thresholdOffset === undefined) return { canvas, label, region, row };
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const threshold = Math.max(35, Math.min(220, otsuThreshold(pixels) + thresholdOffset));
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    const luminance = (pixels.data[offset] ?? 0) * .299 + (pixels.data[offset + 1] ?? 0) * .587 + (pixels.data[offset + 2] ?? 0) * .114;
    const value = luminance < threshold ? 0 : 255;
    pixels.data[offset] = value; pixels.data[offset + 1] = value; pixels.data[offset + 2] = value; pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const clearX = Math.round(canvas.width * .025); const clearY = Math.round(canvas.height * .04);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, clearY); context.fillRect(0, canvas.height - clearY, canvas.width, clearY);
  context.fillRect(0, 0, clearX, canvas.height); context.fillRect(canvas.width - clearX, 0, clearX, canvas.height);
  return { canvas, label, region, row };
}

export async function prepareOcrCandidates(file: File): Promise<readonly OcrCandidate[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const analysisScale = Math.min(1, 900 / bitmap.width, 900 / bitmap.height);
    const analysis = document.createElement('canvas'); analysis.width = Math.max(1, Math.round(bitmap.width * analysisScale)); analysis.height = Math.max(1, Math.round(bitmap.height * analysisScale));
    const context = analysis.getContext('2d', { willReadFrequently: true });
    if (context === null) return [];
    context.drawImage(bitmap, 0, 0, analysis.width, analysis.height);
    const detected = orangeRectangles(context.getImageData(0, 0, analysis.width, analysis.height));
    const rectangles = [...stackedPlacards(detected), ...detected].sort((left, right) => right.score - left.score).slice(0, 10).map((rectangle) => ({ ...rectangle, x: rectangle.x / analysisScale, y: rectangle.y / analysisScale, width: rectangle.width / analysisScale, height: rectangle.height / analysisScale }));
    const candidates = rectangles.slice(0, 6).flatMap((rectangle, index) => {
      const upper = { ...rectangle, height: rectangle.height * .48 };
      const lower = { ...rectangle, y: rectangle.y + rectangle.height * .52, height: rectangle.height * .48 };
      return [
        cropCandidate(bitmap, upper, `верхняя строка ${index + 1}`, index, 'upper'),
        cropCandidate(bitmap, upper, `контрастная верхняя строка ${index + 1}`, index, 'upper', 0),
        cropCandidate(bitmap, lower, `нижняя строка ${index + 1}`, index, 'lower'),
        cropCandidate(bitmap, lower, `контрастная нижняя строка ${index + 1}`, index, 'lower', 0),
        cropCandidate(bitmap, rectangle, `оранжевая область ${index + 1}`, index, 'whole')
      ];
    });
    if (rectangles.length === 0) {
      const lowerCentre: Rectangle = { x: bitmap.width * .15, y: bitmap.height * .38, width: bitmap.width * .7, height: bitmap.height * .6, score: 0 };
      candidates.push(cropCandidate(bitmap, lowerCentre, 'нижняя центральная часть', -1, 'fallback'));
      candidates.push(cropCandidate(bitmap, lowerCentre, 'контрастная нижняя часть', -1, 'fallback', 0));
      for (let row = 0; row < 2; row += 1) for (let column = 0; column < 3; column += 1) {
        const tile: Rectangle = { x: bitmap.width * Math.max(0, column / 3 - .035), y: bitmap.height * Math.max(0, row / 2 - .045), width: bitmap.width * Math.min(.4, 1 - column / 3 + .035), height: bitmap.height * Math.min(.59, 1 - row / 2 + .045), score: 0 };
        const region = -10 - row * 3 - column;
        candidates.push(cropCandidate(bitmap, tile, `контрастный участок ${row + 1}.${column + 1}`, region, 'fallback', 0));
      }
    }
    return candidates;
  } finally {
    bitmap.close();
  }
}
