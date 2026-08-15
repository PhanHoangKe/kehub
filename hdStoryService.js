const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Cấu hình đường dẫn FFmpeg từ package vừa cài
if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
}

/**
 * Xử lý & Làm nét Ảnh cho Facebook Story
 * @param {Buffer} inputBuffer - File ảnh dạng Buffer
 * @param {Object} options - { mode: 'fit_blur'|'crop', sharpLevel: 'standard'|'ultra' }
 * @returns {Promise<Buffer>} Buffer ảnh JPEG đã tối ưu 1080x1920 sRGB
 */
async function processHDImage(inputBuffer, options = {}) {
    const mode = options.mode || 'fit_blur'; // 'fit_blur' | 'crop'
    const sharpLevel = options.sharpLevel || 'ultra'; // 'standard' | 'ultra'

    // Xử lý Cắt 4 Phía (Custom Crop 4 Sides) nếu người dùng có tùy chỉnh
    if (options.cropCustom && (options.cropCustom.top > 0 || options.cropCustom.bottom > 0 || options.cropCustom.left > 0 || options.cropCustom.right > 0)) {
        try {
            const meta = await sharp(inputBuffer).metadata();
            const w = meta.width;
            const h = meta.height;

            const cropLeft = Math.round(((options.cropCustom.left || 0) / 100) * w);
            const cropRight = Math.round(((options.cropCustom.right || 0) / 100) * w);
            const cropTop = Math.round(((options.cropCustom.top || 0) / 100) * h);
            const cropBottom = Math.round(((options.cropCustom.bottom || 0) / 100) * h);

            const extractW = Math.max(20, w - cropLeft - cropRight);
            const extractH = Math.max(20, h - cropTop - cropBottom);

            inputBuffer = await sharp(inputBuffer)
                .extract({ left: cropLeft, top: cropTop, width: extractW, height: extractH })
                .toBuffer();
        } catch (cropErr) {
            console.warn("⚠️ Custom Crop Image failed, fallback to full image:", cropErr.message);
        }
    }

    const TARGET_W = 1080;
    const TARGET_H = 1920;

    let processedPipeline;

    if (mode === 'crop') {
        // Mode Crop: Cắt và phóng to về đúng 1080x1920
        processedPipeline = sharp(inputBuffer)
            .resize(TARGET_W, TARGET_H, {
                fit: 'cover',
                position: 'center',
                kernel: sharp.kernel.lanczos3
            });
    } else {
        // Mode Fit Blur: Nền mờ nghệ thuật + Ảnh gốc ở giữa
        // 1. Tạo layer nền mờ 1080x1920
        const bgLayer = await sharp(inputBuffer)
            .resize(TARGET_W, TARGET_H, { fit: 'cover', position: 'center' })
            .blur(35)
            .modulate({ brightness: 0.8 }) // Giảm độ sáng nền mờ 20%
            .toBuffer();

        // 2. Tạo layer ảnh chính dạng PNG giữ kênh alpha trong suốt
        const fgLayer = await sharp(inputBuffer)
            .resize(TARGET_W, TARGET_H, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
                kernel: sharp.kernel.lanczos3
            })
            .png()
            .toBuffer();

        // 3. Đè ảnh chính lên nền mờ
        processedPipeline = sharp(bgLayer).composite([{ input: fgLayer, top: 0, left: 0 }]);
    }

    // Áp dụng bộ lọc màu Filter nếu có
    const filter = options.filter || 'none';
    if (filter === 'film') {
        processedPipeline = processedPipeline.modulate({ brightness: 1.03, saturation: 0.88 });
    } else if (filter === 'cinematic') {
        processedPipeline = processedPipeline.modulate({ brightness: 0.94, saturation: 1.18 });
    } else if (filter === 'pastel') {
        processedPipeline = processedPipeline.modulate({ brightness: 1.07, saturation: 1.06 });
    } else if (filter === 'sunset') {
        processedPipeline = processedPipeline.modulate({ brightness: 1.02, saturation: 1.25 });
    }

    // Khử nhiễu Đêm (AI Denoise) nếu người dùng bật
    if (options.denoise) {
        processedPipeline = processedPipeline.blur(0.5);
    }

    // Áp dụng bộ lọc Unsharp Masking & Tăng cường tương phản nhẹ (Color enhancement)
    if (sharpLevel === 'ultra') {
        processedPipeline = processedPipeline
            .sharpen({
                sigma: 1.6,
                m1: 1.2,
                m2: 2.5
            })
            .modulate({
                saturation: 1.06,
                brightness: 1.02
            });
    } else {
        processedPipeline = processedPipeline
            .sharpen({
                sigma: 1.1,
                m1: 0.8,
                m2: 1.8
            })
            .modulate({
                saturation: 1.03
            });
    }

    // Xuất ra định dạng JPEG chất lượng cao 96% với màu sRGB
    return await processedPipeline
        .jpeg({
            quality: 96,
            progressive: true,
            chromaSubsampling: '4:4:4', // Giữ chi tiết màu tối đa
            force: true
        })
        .withMetadata({ srgb: true })
        .toBuffer();
}

/**
 * Xử lý & Làm nét Video cho Facebook Story (1080x1920 @ 8-10 Mbps)
 * @param {string} inputPath - Đường dẫn file video tạm trên đĩa
 * @param {string} outputPath - Đường dẫn file video đầu ra
 * @param {Object} options - { mode: 'fit_blur'|'crop', fps: 30|60, sharpLevel: 'standard'|'ultra' }
 * @returns {Promise<string>} outputPath
 */
function processHDVideo(inputPath, outputPath, options = {}) {
    return new Promise((resolve, reject) => {
        const mode = options.mode || 'fit_blur';
        const fps = parseInt(options.fps) || 30;
        const sharpLevel = options.sharpLevel || 'ultra';

        const denoiseFilter = options.denoise ? 'hqdn3d=3:2:4:3,' : '';

        const unsharpFilter = sharpLevel === 'ultra'
            ? `${denoiseFilter}unsharp=luma_msize_x=7:luma_msize_y=7:luma_amount=1.2:chroma_msize_x=5:chroma_msize_y=5:chroma_amount=0.5`
            : `${denoiseFilter}unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.7`;

        let customCropFilter = '';
        if (options.cropCustom && (options.cropCustom.top > 0 || options.cropCustom.bottom > 0 || options.cropCustom.left > 0 || options.cropCustom.right > 0)) {
            const topP = ((options.cropCustom.top || 0) / 100).toFixed(3);
            const botP = ((options.cropCustom.bottom || 0) / 100).toFixed(3);
            const leftP = ((options.cropCustom.left || 0) / 100).toFixed(3);
            const rightP = ((options.cropCustom.right || 0) / 100).toFixed(3);

            const cropWScale = (1 - parseFloat(leftP) - parseFloat(rightP)).toFixed(3);
            const cropHScale = (1 - parseFloat(topP) - parseFloat(botP)).toFixed(3);

            customCropFilter = `crop=in_w*${cropWScale}:in_h*${cropHScale}:in_w*${leftP}:in_h*${topP},`;
        }

        let videoFilterString = '';

        if (mode === 'crop') {
            videoFilterString = `${customCropFilter}scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,${unsharpFilter}`;
        } else {
            // Complex filter graph: Background mờ (gblur) + Foreground vừa vặn ở giữa + Unsharp filter
            videoFilterString = `${customCropFilter}split[bg_in][fg_in];[bg_in]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5,eq=brightness=-0.1[bg];[fg_in]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${unsharpFilter}`;
        }

        ffmpeg(inputPath)
            .outputOptions([
                '-vf', videoFilterString,
                '-c:v', 'libx264',
                '-preset', 'fast',
                '-profile:v', 'high',
                '-level', '4.2',
                '-b:v', '8500k',       // Bitrate ngọt 8.5 Mbps chuẩn Facebook Story
                '-maxrate', '10000k',
                '-bufsize', '15000k',
                '-r', String(fps),
                '-pix_fmt', 'yuv420p',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '44100',
                '-movflags', '+faststart'
            ])
            .output(outputPath)
            .on('end', () => {
                resolve(outputPath);
            })
            .on('error', (err) => {
                console.error('❌ Error processing HD Video:', err);
                reject(err);
            })
            .run();
    });
}

module.exports = {
    processHDImage,
    processHDVideo
};
