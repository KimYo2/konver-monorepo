import ffmpeg
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class VideoProcessorError(Exception):
    """Pengecualian khusus untuk kesalahan pemrosesan video."""
    pass

def get_video_info(input_path):
    """Mendapatkan informasi video menggunakan ffprobe"""
    try:
        probe = ffmpeg.probe(input_path)
        video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        return {
            'width': int(video_info['width']),
            'height': int(video_info['height']),
            'duration': float(probe['format']['duration']),
            'bitrate': int(probe['format']['bit_rate'])
        }
    except ffmpeg.Error as e:
        raise VideoProcessorError(f"Error getting video info: {e.stderr.decode()}")

def calculate_new_dimensions(width, height, target_height):
    """Calculate new dimensions maintaining aspect ratio"""
    aspect_ratio = width / height
    new_height = target_height
    new_width = int(new_height * aspect_ratio)
    # Pastikan lebar genap
    new_width = new_width - (new_width % 2)
    return new_width, new_height

def process_video(input_path, output_path, output_format, compression_crf, target_resolution=None, target_bitrate=None):
    logging.info(f"Processing video: {input_path}")
    logging.info(f"Output format: {output_format}, Compression CRF: {compression_crf}")
    logging.info(f"Target resolution: {target_resolution}, Target bitrate: {target_bitrate}")

    try:
        # Mendapatkan informasi video asli
        video_info = get_video_info(input_path)
        logging.info(f"Original video info: {video_info}")

        # Aliran masukan
        input_stream = ffmpeg.input(input_path)
        video_stream = input_stream.video
        audio_stream = input_stream.audio

        # Mengatur opsi keluaran
        output_options = {'crf': compression_crf}

        # Menangani perubahan resolusi jika ditentukan
        if target_resolution:
            new_width, new_height = calculate_new_dimensions(
                video_info['width'], 
                video_info['height'], 
                target_resolution
            )
            video_stream = ffmpeg.filter(video_stream, 'scale', new_width, new_height)
            logging.info(f"Scaling video to {new_width}x{new_height}")

        # Menangani bitrate jika ditentukan
        if target_bitrate:
            output_options['b:v'] = f"{target_bitrate}k"
            logging.info(f"Setting target bitrate to {target_bitrate}k")

        # Menangani format keluaran yang berbeda
        if output_format == 'mp4':
            # Gunakan codec H.264 untuk MP4 dan AAC untuk audio
            stream = ffmpeg.output(video_stream, audio_stream, output_path, vcodec='libx264', acodec='aac', **output_options)
        elif output_format == 'webm':
            # Gunakan codec VP9 untuk WebM dan libopus untuk audio
            stream = ffmpeg.output(video_stream, audio_stream, output_path, vcodec='libvpx-vp9', acodec='libopus', **output_options)
        elif output_format == 'mkv':
            # Gunakan codec H.264 untuk MKV dan AAC untuk audio
            stream = ffmpeg.output(video_stream, audio_stream, output_path, vcodec='libx264', acodec='aac', **output_options)
        elif output_format == 'mov':
            # Gunakan codec H.264 untuk MOV dan AAC untuk audio
            stream = ffmpeg.output(video_stream, audio_stream, output_path, vcodec='libx264', acodec='aac', **output_options)
        elif output_format == 'avi':
            # Gunakan codec MPEG-4 untuk AVI dan libmp3lame untuk audio
            stream = ffmpeg.output(video_stream, audio_stream, output_path, vcodec='mpeg4', acodec='libmp3lame', **output_options)
        else:
            raise VideoProcessorError(f"Unsupported output format: {output_format}")

        # Jalankan ffmpeg secara asinkron dan kembalikan objek proses
        logging.info(f"Starting ffmpeg process asynchronously for {input_path}")
        process = ffmpeg.run_async(
            stream,
            overwrite_output=True,
            pipe_stderr=True # Penting untuk membaca stderr secara real-time
            # Hapus quiet=True agar output progres muncul
        )
        return process # Mengembalikan objek proses

    except ffmpeg.Error as e:
        error_message = f"FFmpeg error: {e.stderr.decode() if e.stderr else 'Unknown FFmpeg error'}"
        logging.error(error_message)
        raise VideoProcessorError(error_message) from e
    except Exception as e:
        error_message = f"An unexpected error occurred during video processing: {e}"
        logging.error(error_message)
        raise VideoProcessorError(error_message) from e