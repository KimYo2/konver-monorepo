from flask import Flask, request, jsonify, send_file, render_template
from flask_cors import CORS
import os
from werkzeug.utils import secure_filename
from utils.video_processor import process_video, VideoProcessorError, get_video_info
import logging
from urllib.parse import quote_plus
import uuid # Impor uuid untuk ID tugas unik
from concurrent.futures import ThreadPoolExecutor # Impor ThreadPoolExecutor
import ffmpeg
from dotenv import load_dotenv
import time
import threading
import queue
import re

# Load environment variables
load_dotenv()

# Konfigurasi logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(
    __name__,
    template_folder='../frontend/templates',
    static_folder='../frontend/static'
)
# Aktifkan CORS untuk semua asal dan ekspos header Content-Disposition
CORS(app, expose_headers=['Content-Disposition'])

# Konfigurasi
UPLOAD_FOLDER = 'uploads' # Ubah ke folder lokal agar tidak masalah di Windows
OUTPUT_FOLDER = 'outputs' # Ubah ke folder lokal

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER

# Buat folder jika belum ada
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# Inisialisasi ThreadPoolExecutor untuk tugas latar belakang
executor = ThreadPoolExecutor(max_workers=4) # Sesuaikan jumlah worker sesuai kebutuhan
task_progress = {} # Kamus untuk melacak progres tugas

# Global variables for progress tracking
progress_data = {}
progress_lock = threading.Lock()

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in {'mp4', 'webm', 'mkv', 'mov', 'avi'}

def update_progress(task_id, progress_line):
    # Callback ini dipanggil oleh ffmpeg-python untuk memperbarui progres
    # Baris progres terlihat seperti ini: 'frame=   100 fps= 20 q=2.0 size=    1234kB time=00:00:04.00 bitrate=2468.0kbits/s speed=1.5x  '
    # Kita perlu mengurai baris ini untuk mendapatkan waktu dan durasi total (jika tersedia)
    
    parts = progress_line.strip().split(' ')
    progress_dict = {}
    for part in parts:
        if '=' in part:
            key, value = part.split('=', 1)
            progress_dict[key.strip()] = value.strip()

    if 'time' in progress_dict and 'duration' in task_progress[task_id]:
        current_time_str = progress_dict['time']
        # Pastikan current_time_str tidak kosong atau hanya spasi
        if current_time_str:
            try:
                # Format time: HH:MM:SS.ms, kita hanya butuh HH:MM:SS
                time_parts = current_time_str.split(':')
                hours = int(time_parts[0])
                minutes = int(time_parts[1])
                seconds = float(time_parts[2])
                current_time_seconds = hours * 3600 + minutes * 60 + seconds

                total_duration = task_progress[task_id]['duration']
                if total_duration > 0:
                    percentage = (current_time_seconds / total_duration) * 100
                    task_progress[task_id]['progress'] = min(100, max(0, int(percentage))) # Pastikan antara 0-100
                else:
                    task_progress[task_id]['progress'] = 0 # Durasi 0, tidak ada progres
            except ValueError:
                logging.warning(f"Could not parse time string: {current_time_str}")
        else:
            task_progress[task_id]['progress'] = 0 # Tidak ada waktu, tidak ada progres

    logging.info(f"Task {task_id} progress: {task_progress.get(task_id, {}).get('progress', 'N/A')}%")


# Fungsi yang akan dijalankan di ThreadPoolExecutor
def process_and_send_file(task_id, input_path, output_path, output_format, compression_crf, target_resolution, target_bitrate, original_filename_full):
    try:
        # Perbarui status tugas
        task_progress[task_id]['status'] = 'PROCESSING'
        
        # Dapatkan durasi video untuk perhitungan progres
        try:
            video_info = get_video_info(input_path)
            task_progress[task_id]['duration'] = video_info['duration']
        except VideoProcessorError as e:
            task_progress[task_id]['status'] = 'FAILED'
            task_progress[task_id]['error'] = f"Gagal mendapatkan info video: {str(e)}"
            logging.error(f"Task {task_id} failed to get video info: {e}")
            return

        # Lakukan konversi video sebenarnya dan tangkap output stderr secara real-time
        try:
            process = process_video(
                input_path,
                output_path,
                output_format,
                compression_crf,
                target_resolution,
                target_bitrate
            )

            logging.info(f"FFmpeg process started for task {task_id}")

            # Baca stderr secara real-time
            while True:
                line = process.stderr.readline()
                if not line:
                    break
                decoded_line = line.decode('utf-8').strip()
                logging.debug(f"FFmpeg stderr line: {decoded_line}") # Logging detail setiap baris
                if "time=" in decoded_line and "speed=" in decoded_line:
                    update_progress(task_id, decoded_line)

            # Tunggu proses selesai
            process.wait()
            
            # Periksa kode keluar (exit code) dari proses FFmpeg
            if process.returncode != 0:
                error_message = f"FFmpeg process exited with code {process.returncode}. Stderr: {process.stderr.read().decode('utf-8') if process.stderr else 'No stderr'}"
                logging.error(error_message)
                raise VideoProcessorError(error_message)

        except ffmpeg.Error as e:
            error_message = f"FFmpeg error: {e.stderr.decode() if e.stderr else 'Unknown FFmpeg error'}"
            logging.error(error_message)
            raise VideoProcessorError(error_message)
        except Exception as e:
            error_message = f"Terjadi kesalahan tak terduga selama pemrosesan: {str(e)}"
            logging.error(error_message)
            raise VideoProcessorError(error_message)

        logging.info(f"Video processed successfully for task {task_id}: {output_path}")

        # Bersihkan berkas masukan
        os.remove(input_path)
        logging.info(f"Deleted input file for task {task_id}: {input_path}")

        # Atur status selesai dan simpan nama berkas keluaran untuk unduhan
        task_progress[task_id]['status'] = 'COMPLETED'
        task_progress[task_id]['progress'] = 100 # Pastikan progres 100% setelah selesai
        task_progress[task_id]['output_file'] = output_path
        task_progress[task_id]['download_name'] = f"processed_{os.path.splitext(original_filename_full)[0].replace('.', '_')}.{output_format}"
        if target_resolution:
            task_progress[task_id]['download_name'] = f"processed_{os.path.splitext(original_filename_full)[0].replace('.', '_')}_{target_resolution}P.{output_format}"
        task_progress[task_id]['download_name'] = quote_plus(task_progress[task_id]['download_name'])

    except VideoProcessorError as e:
        error_message = f"Pemrosesan video gagal: {str(e)}"
        logging.error(f"Video processing failed for task {task_id}: {e}")
        task_progress[task_id]['status'] = 'FAILED'
        task_progress[task_id]['error'] = error_message
    except Exception as e:
        error_message = f"Terjadi kesalahan tak terduga selama pemrosesan: {str(e)}"
        logging.error(error_message)
        raise VideoProcessorError(error_message)
    finally:
        # Pastikan berkas masukan dihapus jika ada error
        if os.path.exists(input_path):
            os.remove(input_path)
            logging.info(f"Deleted input file in finally block for task {task_id}: {input_path}")

@app.route('/api/test', methods=['GET'])
def test_connection():
    logging.info("Received request to /api/test")
    return jsonify({"message": "Server berjalan!", "status": "success"}), 200

@app.route('/api/process', methods=['POST'])
def process_video_route():
    logging.info("Received request to /api/process (asynchronous)")
    if 'video' not in request.files:
        logging.warning("No video file part in the request.")
        return jsonify({"error": "Tidak ada bagian berkas video"}), 400

    file = request.files['video']
    if file.filename == '':
        logging.warning("No selected file.")
        return jsonify({"error": "Tidak ada berkas terpilih"}), 400

    output_format = request.form.get('output_format', 'mp4').lower()
    compression_crf = request.form.get('compression_crf', '23')
    target_resolution = request.form.get('target_resolution')
    if target_resolution:
        target_resolution = int(target_resolution)
    target_bitrate = request.form.get('target_bitrate')
    if target_bitrate:
        target_bitrate = int(target_bitrate)

    if not allowed_file(file.filename):
        logging.warning(f"File type not allowed: {file.filename}")
        return jsonify({"error": "Tipe berkas tidak diizinkan"}), 400

    original_filename_full = file.filename
    filename_for_save = secure_filename(original_filename_full)
    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename_for_save)
    file.save(input_path) # Simpan berkas masukan sementara

    task_id = str(uuid.uuid4()) # Hasilkan ID tugas unik
    task_progress[task_id] = {
        'status': 'PENDING',
        'progress': 0,
        'error': None,
        'output_file': None,
        'download_name': None,
        'duration': 0, # Akan diperbarui setelah mendapatkan info video
        'original_filename': original_filename_full # Simpan nama berkas asli
    }
    logging.info(f"Starting new task with ID: {task_id} for file: {original_filename_full}")

    # Kirim tugas ke thread pool
    executor.submit(
        process_and_send_file,
        task_id,
        input_path,
        os.path.join(app.config['OUTPUT_FOLDER'], f"temp_{task_id}.{output_format}"), # Nama file output sementara
        output_format,
        compression_crf,
        target_resolution,
        target_bitrate,
        original_filename_full
    )
    
    # Segera kembalikan ID tugas ke frontend
    return jsonify({"message": "Pemrosesan dimulai", "task_id": task_id}), 202

@app.route('/api/progress/<task_id>', methods=['GET'])
def get_progress(task_id):
    progress_info = task_progress.get(task_id)
    if progress_info:
        return jsonify(progress_info), 200
    else:
        return jsonify({"error": "Tugas tidak ditemukan atau sudah selesai/dihapus."}), 404

@app.route('/api/download/<task_id>', methods=['GET'])
def download_file(task_id):
    task_info = task_progress.get(task_id)
    if task_info and task_info['status'] == 'COMPLETED' and task_info['output_file']:
        output_path = task_info['output_file']
        download_name = task_info['download_name']
        
        # Bersihkan dari task_progress setelah diunduh (opsional, tergantung kebijakan)
        # del task_progress[task_id]
        
        return send_file(output_path, as_attachment=True, download_name=download_name)
    elif task_info and task_info['status'] == 'FAILED':
        return jsonify({"error": task_info['error']}), 500
    else:
        return jsonify({"error": "Berkas belum siap untuk diunduh atau tugas tidak ditemukan."}), 404

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/about')
def about():
    return render_template('about.html')

@app.route('/help')
def help_page():
    return render_template('help.html')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)