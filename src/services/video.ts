import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { VIDEO_STICKER_CONFIG } from '../constants/config';

// Limite do WhatsApp para figurinha animada: ~500KB. Acima disso o
// cliente exibe como quebrada ou rejeita.
const MAX_STICKER_BYTES = 500 * 1024; // ~500KB

interface WebpPreset {
  quality: number;
  fps: number;
  cr_threshold: number;
  cr_size: number;
}

// Validado com `ffmpeg -hide_banner -h encoder=libwebp_anim` (FFmpeg 7.1):
// o encoder só aceita lossless, preset, cr_threshold, cr_size e quality.
// compression_level / method / qmin / qmax NÃO existem nesse encoder e
// eram silenciosamente ignorados — removidos.
//
// Benchmark local 6s (testsrc + fundo estático), q68:
// 24fps→20fps economiza ~12% (menos que os 16,7% de frames), q68→q60 ~17%.
// Ordem do fallback: preserva qualidade primeiro, corta FPS depois, só
// então derruba qualidade — 20fps/q68 ainda é bem melhor que 24fps/q32.
const HIGH_QUALITY_PRESET: WebpPreset = {
  quality: 68,
  fps: 24,
  cr_threshold: 0, // 0 = CR desligado (default). Testado localmente: cr>0 aumentou ~60% o tamanho em conteúdo estático e dinâmico.
  cr_size: 16,
};

const MEDIUM_PRESET: WebpPreset = {
  quality: 68,
  fps: 20,
  cr_threshold: 0,
  cr_size: 16,
};

const FALLBACK_PRESET: WebpPreset = {
  quality: 32,
  fps: 20,
  cr_threshold: 0,
  cr_size: 16,
};

const STICKER_ATTEMPTS: Array<{ name: string; preset: WebpPreset }> = [
  { name: 'high (24fps/q68)', preset: HIGH_QUALITY_PRESET },
  { name: 'medium (20fps/q68)', preset: MEDIUM_PRESET },
  { name: 'fallback (20fps/q32)', preset: FALLBACK_PRESET },
];

export const processVideoToAnimatedStickers = async (
  videoPath: string
): Promise<{ square?: Buffer; original?: Buffer }> => {
  const tempDir = path.resolve('./temp');
  const timestamp = Date.now();

  const outputPath = path.resolve(tempDir, `sticker_${timestamp}.webp`);

  try {
    console.log('🎬 Starting video processing...');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const videoInfo = await validateVideoForSticker(videoPath);

    // Redimensiona preservando o aspecto (lado maior → 512px), sem crop,
    // e completa para 512x512 com padding transparente. Nada do conteúdo
    // é cortado e o WebP final é sempre quadrado (spec do WhatsApp).
    console.log('📐 Processing resized sticker (aspect preserved)...');
    const result = await processVideoWithFallback(
      videoPath,
      outputPath,
      videoInfo.duration
    );

    const stickerBuffer = fs.readFileSync(outputPath);

    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    console.log(
      `✅ Sticker created: ${(stickerBuffer.length / 1024).toFixed(2)} KB (final: ${result.attempt}, q=${result.quality}, fps=${result.fps})`
    );

    return {
      square: stickerBuffer,
    };
  } catch (error: any) {
    console.error('❌ Error processing video:', error);
    throw new Error(`Video processing failed: ${error?.message}`);
  }
};

const processVideoWithFallback = async (
  inputPath: string,
  outputPath: string,
  sourceDurationSec: number
): Promise<{ attempt: string; fps: number; quality: number; size: number }> => {
  const effectiveDuration = Math.min(
    sourceDurationSec || VIDEO_STICKER_CONFIG.maxDuration,
    VIDEO_STICKER_CONFIG.maxDuration
  );

  for (let i = 0; i < STICKER_ATTEMPTS.length; i++) {
    const attempt = STICKER_ATTEMPTS[i];
    if (!attempt) continue;
    const { name, preset } = attempt;
    await processVideoWithFFmpeg(inputPath, outputPath, preset);

    const size = fs.existsSync(outputPath)
      ? fs.statSync(outputPath).size
      : Infinity;
    const totalFrames = Math.round(effectiveDuration * preset.fps);
    console.log(
      `📦 tentativa ${i + 1}/${STICKER_ATTEMPTS.length} ${name}: ${(size / 1024).toFixed(2)} KB, ` +
        `dur=${effectiveDuration.toFixed(2)}s fps=${preset.fps} frames~${totalFrames} q=${preset.quality}`
    );

    if (size <= MAX_STICKER_BYTES) {
      if (i > 0) {
        console.log(`✅ fallback acionado, resultado final: ${name}`);
      }
      return { attempt: name, fps: preset.fps, quality: preset.quality, size };
    }

    console.log(
      `⚠️ excedeu ${(MAX_STICKER_BYTES / 1024).toFixed(0)}KB, tentando próximo estágio...`
    );
  }

  const last = STICKER_ATTEMPTS[STICKER_ATTEMPTS.length - 1] ?? {
    name: 'fallback (20fps/q32)',
    preset: FALLBACK_PRESET,
  };
  const size = fs.existsSync(outputPath)
    ? fs.statSync(outputPath).size
    : Infinity;
  console.log(
    `⚠️ ainda acima do limite após fallback: ${(size / 1024).toFixed(2)} KB (${last.name})`
  );
  return {
    attempt: last.name,
    fps: last.preset.fps,
    quality: last.preset.quality,
    size,
  };
};

const processVideoWithFFmpeg = (
  inputPath: string,
  outputPath: string,
  preset: WebpPreset = HIGH_QUALITY_PRESET
): Promise<void> => {
  return new Promise((resolve, reject) => {
    console.log('🔍 Processing resized format...');

    // Redimensiona sem cortar: lado maior → 512px, aspecto preservado,
    // e completa para 512x512 com fundo transparente (exigência do
    // WhatsApp — sem o pad o cliente exibe a figurinha como quebrada).
    // O segundo scale arredonda para dimensão par (exigência do yuva420p).
    const videoFilter =
      'scale=512:512:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';

    ffmpeg(inputPath)
      .duration(VIDEO_STICKER_CONFIG.maxDuration)
      .outputOptions([
        '-c:v libwebp_anim',
        '-pix_fmt yuva420p', // Best pixel format for cross-platform compatibility
        `-vf ${videoFilter},fps=${preset.fps}`,
        '-loop 0',
        '-an', // No audio
        '-preset default',
        `-quality ${preset.quality}`,
        `-cr_threshold ${preset.cr_threshold}`,
        `-cr_size ${preset.cr_size}`,
        '-metadata:s:v:0 alpha_mode=1', // Ensure alpha channel metadata for transparency
        '-f webp',
      ])
      .output(outputPath)
      .format('webp')
      .on('start', (commandLine: string) => {
        console.log('🔄 FFmpeg:', commandLine);
      })
      .on('progress', (progress: any) => {
        console.log(`📊 progress: ${Math.round(progress.percent || 0)}%`);
      })
      .on('end', () => {
        console.log('✅ sticker completed');
        resolve();
      })
      .on('error', (error: any) => {
        console.error('❌ FFmpeg error:', error);
        reject(error);
      })
      .run();
  });
};

const validateVideoForSticker = async (
  videoPath: string
): Promise<{
  width: number;
  height: number;
  duration: number;
  fileSize: number;
}> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, metadata) => {
      if (error) {
        reject(new Error(`Error analyzing video: ${error.message}`));
        return;
      }

      const videoStream = metadata.streams.find(
        stream => stream.codec_type === 'video'
      );

      if (!videoStream) {
        reject(new Error('No video stream found'));
        return;
      }

      const duration = metadata.format.duration ?? 0;
      // Long videos are trimmed to the first maxDuration seconds by FFmpeg,
      // so duration is not a rejection reason here.

      const fileSize = metadata.format.size ?? 0;
      if (fileSize > VIDEO_STICKER_CONFIG.maxFileSize) {
        reject(new Error('File too large. Maximum: 50MB'));
        return;
      }

      const width = videoStream.width ?? 0;
      const height = videoStream.height ?? 0;

      console.log(
        `📐 Video valid: ${width}x${height}, ${duration}s, ${Math.round(fileSize / 1024)}KB`
      );

      resolve({
        width,
        height,
        duration,
        fileSize,
      });
    });
  });
};

export const optimizeVideoForProcessing = async (
  inputPath: string,
  outputPath: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    // NOTA: função atualmente não é chamada — o fluxo principal converte
    // direto do original para WebP (processVideoToAnimatedStickers), o que
    // preserva qualidade. Se precisar do intermediário H.264, mantenha o
    // FPS original (24) e CRF baixo para não descartar frames nem gerar
    // artefatos antes do encoder final.
    console.log(' Optimizing vídeo...');

    ffmpeg(inputPath)
      .size('720x720')
      .fps(VIDEO_STICKER_CONFIG.fps)
      .duration(VIDEO_STICKER_CONFIG.maxDuration)
      .videoCodec('libx264')
      .outputOptions([
        '-preset fast',
        '-crf 20',
        '-an', // Remove audio
      ])

      .output(outputPath)
      .on('end', () => {
        console.log('✅ Video optimized');
        resolve(outputPath);
      })
      .on('error', reject)
      .run();
  });
};

export const isVideoFile = (mimetype: string): boolean => {
  const videoMimetypes = [
    'video/mp4',
    'video/mpeg',
    'video/quicktime',
    'video/x-msvideo',
    'video/webm',
  ];

  return videoMimetypes.includes(mimetype);
};

export const estimateStickerSize = async (
  videoPath: string
): Promise<{
  estimatedSize: number;
  duration: number;
  fps: number;
}> => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      const duration = Math.min(
        metadata.format.duration || 0,
        VIDEO_STICKER_CONFIG.maxDuration
      );
      const fps = VIDEO_STICKER_CONFIG.fps;
      const totalFrames = duration * fps;

      const estimatedSize = totalFrames * 2 * 1024;

      resolve({
        estimatedSize,
        duration,
        fps,
      });
    });
  });
};
