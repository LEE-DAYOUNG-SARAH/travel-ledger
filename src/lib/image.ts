/** 사진을 긴 변 maxPx 로 축소한 JPEG base64 로 변환 (업로드 용량 절감, 서버리스 4.5MB 제한 대비) */
export async function compressImage(file: File, maxPx = 1100, quality = 0.72): Promise<{ mime: string; data: string; preview: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { mime: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl }
}
