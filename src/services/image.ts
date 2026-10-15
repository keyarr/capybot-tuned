import sharp from 'sharp';

const STICKER_SIZE = 512;

export const processImageToSticker = async (
  imageBuffer: Buffer
): Promise<{ square?: Buffer; original?: Buffer }> => {
  try {
    console.log('🖼️ Processing image to sticker...');

    const metadata = await sharp(imageBuffer).metadata();
    console.log(`📐 Original image: ${metadata.width}x${metadata.height}`);

    // Redimensiona preservando o aspecto (fit inside): o lado maior vai
    // a 512px, sem cortar nada. Sem padding — o WebP final é retangular
    // quando a origem não é quadrada, e o WhatsApp aceita sticker assim.
    console.log('📐 Resizing image preserving aspect ratio...');
    const stickerBuffer = await sharp(imageBuffer)
      .resize(STICKER_SIZE, STICKER_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: 85,
        effort: 6,
      })
      .toBuffer();

    const outMeta = await sharp(stickerBuffer).metadata();
    console.log(
      `✅ Sticker created: ${outMeta.width}x${outMeta.height}, ${stickerBuffer.length} bytes`
    );

    return {
      square: stickerBuffer,
    };
  } catch (error) {
    console.error('❌ Error processing image:', error);
    throw new Error('Image processing failed');
  }
};
