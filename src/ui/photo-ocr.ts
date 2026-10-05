export type OcrCandidate = Readonly<{ canvas: HTMLCanvasElement; label: string; region: number; row: 'upper' | 'lower' | 'whole' | 'fallback' }>;

type Rectangle = Readonly<{ x: number; y: number; width: number; height: number; score: number; angle?: number }>;

function orangePixel(red: number, green: number, blue: number): boolean {
  // Real placards are frequently photographed in shade or overexposed by a
  // phone camera. A narrow RGB interval rejected both pale yellow-orange and
  // dark orange plates even though their hue was still unambiguous.
  return red >= 105 && green >= 30 && blue <= 175 && red - green >= 18 && red - blue >= 35 && green >= blue * .75;
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
    let sumX = 0; let sumY = 0; let sumXX = 0; let sumYY = 0; let sumXY = 0;
    queue[tail++] = start; visited[start] = 1;
    while (head < tail) {
      const current = queue[head++] ?? 0; const x = current % width; const y = Math.floor(current / width); count += 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
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
    // A photograph may contain either a small placard on a tanker or a tightly
    // cropped placard filling almost the entire frame. Do not discard the
    // latter merely because the orange field is large.
    if (boxWidth < 12 || boxHeight < 7 || ratio < .55 || ratio > 4.5 || relativeArea < .00008 || relativeArea > .82 || density < .08) continue;
    const sizeScore = Math.min(1, relativeArea / .012);
    const meanX = sumX / count; const meanY = sumY / count;
    const covarianceXX = sumXX / count - meanX * meanX; const covarianceYY = sumYY / count - meanY * meanY; const covarianceXY = sumXY / count - meanX * meanY;
    const angle = .5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
    rectangles.push({ x: minX, y: minY, width: boxWidth, height: boxHeight, score: density * (.8 + sizeScore), angle });
  }
  return rectangles.sort((left, right) => right.score - left.score).slice(0, 16);
}

function orangeCoverage(image: ImageData): number {
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (orangePixel(image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0)) count += 1;
  }
  return count / Math.max(1, image.width * image.height);
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
    merged.push({ x, y, width, height, score: (upper.score + lower.score) / 2 + .35, angle: (upper.angle ?? 0) * .5 + (lower.angle ?? 0) * .5 });
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

function cropCandidate(bitmap: ImageBitmap, rectangle: Rectangle, label: string, region: number, row: OcrCandidate['row'], thresholdOffset?: number, edgeClearFraction = .055, denoise = false): OcrCandidate {
  const marginX = rectangle.width * .03; const marginY = rectangle.height * .08;
  const sourceX = Math.max(0, rectangle.x - marginX); const sourceY = Math.max(0, rectangle.y - marginY);
  const sourceWidth = Math.min(bitmap.width - sourceX, rectangle.width + marginX * 2); const sourceHeight = Math.min(bitmap.height - sourceY, rectangle.height + marginY * 2);
  // A phone photo is commonly 4000×3000 px. The old lower bound of 2 enlarged
  // such a crop to roughly 8000×6000 and could exhaust the Android WebView.
  // Keep the longest edge near 720 px instead: enlarge only genuinely small
  // distant placards and downscale close-up camera originals.
  const scale = Math.min(6, Math.max(.12, 720 / Math.max(sourceWidth, sourceHeight, 1)));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return { canvas, label, region, row };
  context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  const angle = Math.abs(rectangle.angle ?? 0) <= Math.PI / 12 ? rectangle.angle ?? 0 : 0;
  context.save();
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(-angle);
  if (denoise) context.filter = `blur(${Math.max(.55, Math.min(1.4, scale * .16))}px)`;
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
  context.restore();
  if (thresholdOffset !== undefined) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const threshold = Math.max(35, Math.min(220, otsuThreshold(pixels) + thresholdOffset));
    for (let offset = 0; offset < pixels.data.length; offset += 4) {
      const luminance = (pixels.data[offset] ?? 0) * .299 + (pixels.data[offset + 1] ?? 0) * .587 + (pixels.data[offset + 2] ?? 0) * .114;
      const value = luminance < threshold ? 0 : 255;
      pixels.data[offset] = value; pixels.data[offset + 1] = value; pixels.data[offset + 2] = value; pixels.data[offset + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
  }
  // The black frame and drawing dimension lines are frequently interpreted as
  // an extra leading "1" (1202 -> 1120/11202). Remove a wider edge strip from
  // every variant, including the raw colour crop; real digits are centred well
  // inside a normative orange plate.
  const clearX = Math.round(canvas.width * edgeClearFraction); const clearY = Math.round(canvas.height * .04);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, clearY); context.fillRect(0, canvas.height - clearY, canvas.width, clearY);
  context.fillRect(0, 0, clearX, canvas.height); context.fillRect(canvas.width - clearX, 0, clearX, canvas.height);
  return { canvas, label, region, row };
}

function expandedHalfRectangle(bitmap: ImageBitmap, rectangle: Rectangle, direction: 'up' | 'down'): Rectangle | undefined {
  const ratio = rectangle.width / Math.max(1, rectangle.height);
  const relativeArea = rectangle.width * rectangle.height / Math.max(1, bitmap.width * bitmap.height);
  // On a tanker painted orange the lower half of the placard is often the
  // only isolated colour component: the upper half visually merges with the
  // tank body. Expand compact, row-shaped components vertically to recover
  // the missing Kemler row. Large orange vehicle panels are deliberately not
  // expanded.
  if (ratio < 1.15 || ratio > 4.8 || relativeArea > .035) return undefined;
  const x = Math.max(0, rectangle.x - rectangle.width * .08);
  const width = Math.min(bitmap.width - x, rectangle.width * 1.16);
  const y = direction === 'up'
    ? Math.max(0, rectangle.y - rectangle.height * 1.18)
    : Math.max(0, rectangle.y - rectangle.height * .08);
  const height = Math.min(bitmap.height - y, rectangle.height * 2.3);
  if (height <= rectangle.height * 1.45) return undefined;
  return { x, y, width, height, score: rectangle.score + .2, ...(rectangle.angle === undefined ? {} : { angle: rectangle.angle }) };
}

function contextCandidates(bitmap: ImageBitmap, rectangle: Rectangle, index: number): readonly OcrCandidate[] {
  const candidates: OcrCandidate[] = [];
  for (const direction of ['up', 'down'] as const) {
    const expanded = expandedHalfRectangle(bitmap, rectangle, direction);
    if (expanded === undefined) continue;
    const upper = { ...expanded, height: expanded.height * .48 };
    const lower = { ...expanded, y: expanded.y + expanded.height * .52, height: expanded.height * .48 };
    const directionLabel = direction === 'up' ? 'выше номера ООН' : 'ниже номера опасности';
    candidates.push(
      cropCandidate(bitmap, expanded, `контрастный контекст ${directionLabel} ${index + 1}`, index, 'whole', 0),
      cropCandidate(bitmap, upper, `контрастная верхняя строка ${directionLabel} ${index + 1}`, index, 'upper', 0),
      cropCandidate(bitmap, lower, `контрастная нижняя строка ${directionLabel} ${index + 1}`, index, 'lower', 0),
      cropCandidate(bitmap, expanded, `исходная контекстная табличка ${directionLabel} ${index + 1}`, index, 'whole'),
      cropCandidate(bitmap, upper, `исходная верхняя строка ${directionLabel} ${index + 1}`, index, 'upper'),
      cropCandidate(bitmap, lower, `исходная нижняя строка ${directionLabel} ${index + 1}`, index, 'lower')
    );
  }
  return candidates;
}

export async function prepareOcrCandidates(file: File): Promise<readonly OcrCandidate[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const analysisScale = Math.min(1, 900 / bitmap.width, 900 / bitmap.height);
    const analysis = document.createElement('canvas'); analysis.width = Math.max(1, Math.round(bitmap.width * analysisScale)); analysis.height = Math.max(1, Math.round(bitmap.height * analysisScale));
    const context = analysis.getContext('2d', { willReadFrequently: true });
    if (context === null) return [];
    context.drawImage(bitmap, 0, 0, analysis.width, analysis.height);
    const analysisPixels = context.getImageData(0, 0, analysis.width, analysis.height);
    const detected = orangeRectangles(analysisPixels);
    // An orange tanker can occupy 20–30% of the frame without being a close-up
    // of its placard. A higher threshold prevents wasteful full-photo OCR in
    // that case while preserving genuine close-up plates.
    const closeUpPlacard = orangeCoverage(analysisPixels) >= .36;
    const rectangles = [...stackedPlacards(detected), ...detected].sort((left, right) => right.score - left.score).slice(0, 10).map((rectangle) => ({ ...rectangle, x: rectangle.x / analysisScale, y: rectangle.y / analysisScale, width: rectangle.width / analysisScale, height: rectangle.height / analysisScale }));
    const primaryCandidates: OcrCandidate[] = [];
    const fallbackCandidates: OcrCandidate[] = [];
    const secondaryCandidates: OcrCandidate[] = [];
    for (const [index, rectangle] of rectangles.slice(0, 2).entries()) {
      const upper = { ...rectangle, height: rectangle.height * .48 };
      const lower = { ...rectangle, y: rectangle.y + rectangle.height * .52, height: rectangle.height * .48 };
      const main = [
        // Read the isolated orange component first. On distant tanker photos it
        // often already contains the complete four-digit UN row; the verified
        // local directory can then restore its unique Kemler number without
        // running every expensive enhancement variant.
        cropCandidate(bitmap, rectangle, `контрастная табличка целиком ${index + 1}`, index, 'whole', 0),
        ...contextCandidates(bitmap, rectangle, index),
        cropCandidate(bitmap, upper, `контрастная верхняя строка ${index + 1}`, index, 'upper', 0),
        cropCandidate(bitmap, lower, `контрастная нижняя строка ${index + 1}`, index, 'lower', 0),
      ];
      if (index === 0) primaryCandidates.push(...main);
      else secondaryCandidates.push(...main);
      if (index === 0) fallbackCandidates.push(
        cropCandidate(bitmap, rectangle, 'исходная табличка целиком 1', index, 'whole'),
        cropCandidate(bitmap, upper, 'исходная верхняя строка 1', index, 'upper'),
        cropCandidate(bitmap, lower, 'исходная нижняя строка 1', index, 'lower'),
        cropCandidate(bitmap, lower, 'мягкая нижняя строка 1', index, 'lower', -24),
        cropCandidate(bitmap, upper, 'очищенная верхняя строка 1', index, 'upper', 0, .055, true),
        cropCandidate(bitmap, lower, 'очищенная нижняя строка 1', index, 'lower', 0, .055, true),
        cropCandidate(bitmap, lower, 'нижняя строка без рамки 1', index, 'lower', 0, .095)
      );
    }
    const closeUpCandidates: OcrCandidate[] = [];
    // A close-up of the orange plate is a common mobile input. Always add a
    // lightweight full-frame pair so the two number rows are read even when
    // the colour detector sees the plate border as the image boundary.
    if (closeUpPlacard) {
      const fullFrame: Rectangle = { x: 0, y: 0, width: bitmap.width, height: bitmap.height, score: 0 };
      const fullUpper = { ...fullFrame, y: bitmap.height * .04, height: bitmap.height * .43 };
      const fullLower = { ...fullFrame, y: bitmap.height * .51, height: bitmap.height * .45 };
      closeUpCandidates.push(cropCandidate(bitmap, fullFrame, 'контрастная крупная табличка целиком', -2, 'whole', 0));
      closeUpCandidates.push(cropCandidate(bitmap, fullUpper, 'контрастная верхняя строка крупной таблички', -2, 'upper', 0));
      closeUpCandidates.push(cropCandidate(bitmap, fullLower, 'контрастная нижняя строка крупной таблички', -2, 'lower', 0));
      closeUpCandidates.push(cropCandidate(bitmap, fullFrame, 'исходная крупная табличка целиком', -2, 'whole'));
      closeUpCandidates.push(cropCandidate(bitmap, fullUpper, 'исходная верхняя строка крупной таблички', -2, 'upper'));
      closeUpCandidates.push(cropCandidate(bitmap, fullLower, 'исходная нижняя строка крупной таблички', -2, 'lower'));
    }
    const candidates = [...primaryCandidates, ...closeUpCandidates, ...fallbackCandidates, ...secondaryCandidates];
    if (rectangles.length === 0) {
      // Low light, reflections or a photographed screen can hide the orange
      // colour from the detector. Native ML Kit still reads the two rows well,
      // so always provide a bounded raw full-frame pair in this case.
      const fullFrame: Rectangle = { x: 0, y: 0, width: bitmap.width, height: bitmap.height, score: 0 };
      const fullUpper = { ...fullFrame, y: bitmap.height * .04, height: bitmap.height * .43 };
      const fullLower = { ...fullFrame, y: bitmap.height * .51, height: bitmap.height * .45 };
      candidates.push(cropCandidate(bitmap, fullFrame, 'исходная табличка без цветового контура', -1, 'whole'));
      candidates.push(cropCandidate(bitmap, fullUpper, 'исходная верхняя строка без цветового контура', -1, 'upper'));
      candidates.push(cropCandidate(bitmap, fullLower, 'исходная нижняя строка без цветового контура', -1, 'lower'));
      const lowerCentre: Rectangle = { x: bitmap.width * .15, y: bitmap.height * .38, width: bitmap.width * .7, height: bitmap.height * .6, score: 0 };
      candidates.push(cropCandidate(bitmap, lowerCentre, 'нижняя центральная часть', -1, 'fallback'));
      candidates.push(cropCandidate(bitmap, lowerCentre, 'контрастная нижняя часть', -1, 'fallback', 0));
      for (let row = 0; row < 2; row += 1) for (let column = 0; column < 2; column += 1) {
        const tile: Rectangle = { x: bitmap.width * Math.max(0, column / 2 - .04), y: bitmap.height * Math.max(0, row / 2 - .045), width: bitmap.width * Math.min(.56, 1 - column / 2 + .04), height: bitmap.height * Math.min(.59, 1 - row / 2 + .045), score: 0 };
        const region = -10 - row * 2 - column;
        candidates.push(cropCandidate(bitmap, tile, `контрастный участок ${row + 1}.${column + 1}`, region, 'fallback', 0));
      }
    }
    return candidates;
  } finally {
    bitmap.close();
  }
}

export async function prepareOcrSpatialCandidate(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    // The camera original can be tens of megapixels. Tesseract does not gain
    // useful placard detail beyond this size, while memory use and recognition
    // time grow sharply on Android.
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context !== null) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    }
    return canvas;
  } finally {
    bitmap.close();
  }
}
