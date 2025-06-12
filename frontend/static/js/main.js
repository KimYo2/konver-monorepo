document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM Content Loaded"); // Log debug

  const uploadArea = document.getElementById("uploadArea");
  const videoInput = document.getElementById("video-input");
  const fileNameDisplay = document.getElementById("fileNameDisplay");
  const outputFormatSelect = document.getElementById("outputFormat");
  const compressionCrfInput = document.getElementById("compressionCrf");
  const targetResolutionSelect = document.getElementById("targetResolution");
  const targetBitrateSelect = document.getElementById("targetBitrate");
  const processVideoBtn = document.getElementById("processVideoBtn");
  const progressBarContainer = document.getElementById("progressBarContainer");
  const progressBar = document.getElementById("progressBar");
  const liveToast = document.getElementById("liveToast");
  const toastBody = document.getElementById("toastBody");

  let selectedFiles = []; // Array untuk menyimpan objek File dan elemen UI terkait
  const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
  const ALLOWED_MIME_TYPES = [
    "video/mp4",
    "video/webm",
    "video/x-matroska", // .mkv
    "video/quicktime", // .mov
    "video/avi",
    "video/x-msvideo", // .avi alternatif
  ];
  const ALLOWED_EXTENSIONS = ["mp4", "webm", "mkv", "mov", "avi"];

  const showToast = (message, isError = false) => {
    console.log("Showing toast:", message); // Log debug
    toastBody.textContent = message;
    liveToast.className = `toast align-items-center text-white border-0 ${
      isError ? "bg-danger" : "bg-primary"
    }`;
    const toast = new bootstrap.Toast(liveToast);
    toast.show();
  };

  // Uji koneksi backend
  const testBackendConnection = async () => {
    try {
      console.log("Testing backend connection..."); // Log debug
      const response = await fetch("http://localhost:5000/api/test");
      const data = await response.json();
      if (data.status === "success") {
        showToast(`Koneksi Backend: ${data.message}`, false);
      } else {
        showToast(`Koneksi Backend gagal: ${data.message}`, true);
      }
    } catch (error) {
      showToast(
        `Error koneksi Backend: ${error.message}. Pastikan server backend berjalan.`,
        true
      );
      console.error("Backend connection error:", error);
    }
  };

  testBackendConnection();

  // Fungsionalitas Seret dan Lepas
  uploadArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("highlight");
  });

  uploadArea.addEventListener("dragleave", () => {
    uploadArea.classList.remove("highlight");
  });

  uploadArea.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("highlight");
    handleSelectedFiles(e.dataTransfer.files);
  });

  // Perubahan masukan berkas
  videoInput.addEventListener("change", (e) => {
    console.log("File input changed"); // Log debug
    handleSelectedFiles(e.target.files);
  });

  // Fungsi baru untuk menangani beberapa berkas
  const handleSelectedFiles = (files) => {
    selectedFiles = []; // Bersihkan pilihan sebelumnya
    fileNameDisplay.innerHTML = ""; // Bersihkan tampilan sebelumnya
    processVideoBtn.disabled = true;

    if (files.length === 0) {
      showToast("Tidak ada berkas terpilih.", true);
      return;
    }

    let validFilesCount = 0;
    const fileListElement = document.createElement("ul");
    fileListElement.classList.add("list-group", "mt-3");

    for (const file of files) {
      let isValid = true;
      let validationMessage = "";

      // Validasi ukuran berkas
      if (file.size > MAX_FILE_SIZE) {
        isValid = false;
        validationMessage = `Ukuran berkas melebihi batas ${
          MAX_FILE_SIZE / (1024 * 1024)
        } MB.`;
      }

      // Validasi ekstensi berkas
      const fileExtension = file.name.split(".").pop().toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(fileExtension)) {
        isValid = false;
        validationMessage = `Tipe berkas tidak didukung: ${fileExtension}. Harap unggah MP4, WebM, MKV, MOV, atau AVI.`;
      }

      const listItem = document.createElement("li");
      listItem.classList.add(
        "list-group-item",
        "d-flex",
        "flex-column",
        "align-items-start",
        "mb-2"
      );

      const fileHeader = document.createElement("div");
      fileHeader.classList.add(
        "d-flex",
        "justify-content-between",
        "align-items-center",
        "w-100",
        "mb-2"
      );

      const fileNameInfo = document.createElement("span");
      fileNameInfo.textContent = `${file.name} (${(
        file.size /
        (1024 * 1024)
      ).toFixed(2)} MB)`;

      const fileActions = document.createElement("div");
      fileActions.classList.add("file-actions");

      const statusBadge = document.createElement("span");
      statusBadge.classList.add("badge", "rounded-pill", "me-2");

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.classList.add(
        "btn",
        "btn-sm",
        "btn-danger",
        "delete-file-btn"
      );
      deleteButton.innerHTML = '<i class="fas fa-times"></i>';
      deleteButton.dataset.fileName = file.name;
      deleteButton.dataset.fileSize = file.size;

      deleteButton.addEventListener("click", (e) => {
        const fileNameToDelete = e.currentTarget.dataset.fileName;
        const fileSizeToDelete = parseInt(e.currentTarget.dataset.fileSize);

        // Hapus berkas dari array selectedFiles
        selectedFiles = selectedFiles.filter(
          (item) =>
            !(
              item.file.name === fileNameToDelete &&
              item.file.size === fileSizeToDelete
            )
        );

        // Hapus listItem dari DOM
        e.currentTarget.closest("li").remove();

        // Perbarui validFilesCount dan status tombol proses
        if (selectedFiles.length === 0) {
          processVideoBtn.disabled = true;
          showToast("Tidak ada berkas yang valid untuk diproses.", true);
        } else {
          processVideoBtn.disabled = false;
          // Tampilkan ulang pesan sukses jika masih ada file valid
          showToast(
            `${selectedFiles.length} berkas terpilih dan siap untuk diproses.`,
            false
          );
        }

        // Jika tidak ada file tersisa, hapus daftar dari display
        if (selectedFiles.length === 0) {
          fileNameDisplay.innerHTML = "";
        }
      });

      const fileEntry = {
        file: file,
        status: isValid ? "Siap" : "Error",
        progress: 0,
        task_id: null,
        progressBarEl: null,
        progressTextEl: null,
        downloadLinkEl: null,
        pollingInterval: null,
      };

      if (isValid) {
        statusBadge.classList.add("bg-success");
        statusBadge.textContent = "Siap";
        selectedFiles.push(fileEntry);
        validFilesCount++;
      } else {
        statusBadge.classList.add("bg-danger");
        statusBadge.textContent = `Error: ${validationMessage}`;
      }

      fileActions.appendChild(statusBadge);
      fileActions.appendChild(deleteButton);
      fileHeader.appendChild(fileNameInfo);
      fileHeader.appendChild(fileActions);
      listItem.appendChild(fileHeader);

      // Tambahkan elemen progress bar dan teks persentase
      const progressBarContainerDiv = document.createElement("div");
      progressBarContainerDiv.classList.add("progress", "w-100");
      progressBarContainerDiv.style.height = "25px";
      progressBarContainerDiv.style.display = "none"; // Sembunyikan secara default

      const progressBarDiv = document.createElement("div");
      progressBarDiv.classList.add(
        "progress-bar",
        "progress-bar-striped",
        "progress-bar-animated"
      );
      progressBarDiv.role = "progressbar";
      progressBarDiv.style.width = "0%";
      progressBarDiv.setAttribute("aria-valuenow", "0");
      progressBarDiv.setAttribute("aria-valuemin", "0");
      progressBarDiv.setAttribute("aria-valuemax", "100");

      const progressTextSpan = document.createElement("span");
      progressTextSpan.textContent = "0%";

      progressBarDiv.appendChild(progressTextSpan);
      progressBarContainerDiv.appendChild(progressBarDiv);
      listItem.appendChild(progressBarContainerDiv);

      // Tambahkan elemen untuk tautan unduh (sembunyikan secara default)
      const downloadLinkDiv = document.createElement("div");
      downloadLinkDiv.classList.add("mt-2", "download-area");
      downloadLinkDiv.style.display = "none"; // Sembunyikan secara default
      listItem.appendChild(downloadLinkDiv);

      // Simpan referensi ke elemen-elemen ini di objek fileEntry
      fileEntry.progressBarEl = progressBarDiv;
      fileEntry.progressTextEl = progressTextSpan;
      fileEntry.progressBarContainerEl = progressBarContainerDiv;
      fileEntry.downloadLinkEl = downloadLinkDiv;

      fileListElement.appendChild(listItem);
    }

    fileNameDisplay.appendChild(fileListElement); // Tambahkan daftar ke area tampilan

    if (validFilesCount > 0) {
      processVideoBtn.disabled = false;
      showToast(
        `${validFilesCount} berkas terpilih dan siap untuk diproses.`,
        false
      );
    } else {
      showToast("Tidak ada berkas yang valid untuk diproses.", true);
    }
  };

  // Fungsi untuk polling progres
  const pollProgress = async (fileEntry) => {
    const {
      task_id,
      progressBarEl,
      progressTextEl,
      progressBarContainerEl,
      downloadLinkEl,
    } = fileEntry;
    if (!task_id) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(
          `http://localhost:5000/api/progress/${task_id}`
        );
        const data = await response.json();

        if (data.status === "PROCESSING") {
          progressBarContainerEl.style.display = "block";
          const percentage = data.progress || 0;
          progressBarEl.style.width = `${percentage}%`;
          progressBarEl.setAttribute("aria-valuenow", percentage);
          progressTextEl.textContent = `${percentage}%`;
          fileEntry.status = "Processing"; // Perbarui status internal
        } else if (data.status === "COMPLETED") {
          clearInterval(interval);
          fileEntry.pollingInterval = null;
          progressBarEl.style.width = "100%";
          progressBarEl.setAttribute("aria-valuenow", "100");
          progressTextEl.textContent = "100%";
          fileEntry.status = "Completed";
          progressBarEl.classList.remove(
            "progress-bar-animated",
            "progress-bar-striped"
          );
          progressBarEl.classList.add("bg-success"); // Ubah warna jadi hijau
          showToast(`Berkas ${fileEntry.file.name} berhasil diproses!`, false);

          // Tampilkan tautan unduh
          if (data.download_name) {
            const downloadButton = document.createElement("a");
            downloadButton.href = `http://localhost:5000/api/download/${task_id}`;
            downloadButton.download = decodeURIComponent(
              data.download_name.replace(/\+/g, " ")
            ); // Decode + to space
            downloadButton.classList.add(
              "btn",
              "btn-success",
              "btn-sm",
              "mt-2"
            );
            downloadButton.innerHTML =
              '<i class="fas fa-download me-1"></i> Unduh';
            downloadLinkEl.innerHTML = ""; // Bersihkan jika ada konten sebelumnya
            downloadLinkEl.appendChild(downloadButton);
            downloadLinkEl.style.display = "block";
          }
        } else if (data.status === "FAILED") {
          clearInterval(interval);
          fileEntry.pollingInterval = null;
          progressBarContainerEl.style.display = "none"; // Sembunyikan progress bar
          fileEntry.status = "Failed";
          showToast(
            `Error memproses ${fileEntry.file.name}: ${
              data.error || "Tidak diketahui"
            }`,
            true
          );
          // Tampilkan pesan error di UI file item jika diperlukan
          const statusBadgeEl = fileEntry.progressBarEl
            .closest("li")
            .querySelector(".badge");
          if (statusBadgeEl) {
            statusBadgeEl.classList.remove("bg-success");
            statusBadgeEl.classList.add("bg-danger");
            statusBadgeEl.textContent = `Error: ${
              data.error || "Tidak diketahui"
            }`;
          }
        } else {
          // PENDING atau status lain
          progressBarContainerEl.style.display = "block";
          progressBarEl.style.width = "0%";
          progressTextEl.textContent = "0%";
        }
      } catch (error) {
        clearInterval(interval);
        fileEntry.pollingInterval = null;
        progressBarContainerEl.style.display = "none";
        showToast(
          `Error jaringan saat polling progres untuk ${fileEntry.file.name}: ${error.message}`,
          true
        );
        console.error(`Polling error for task ${task_id}:`, error);
        fileEntry.status = "Failed";
        // Update UI dengan pesan error
        const statusBadgeEl = fileEntry.progressBarEl
          .closest("li")
          .querySelector(".badge");
        if (statusBadgeEl) {
          statusBadgeEl.classList.remove("bg-success");
          statusBadgeEl.classList.add("bg-danger");
          statusBadgeEl.textContent = `Error: ${error.message}`;
        }
      }
    }, 1000); // Polling setiap 1 detik
    fileEntry.pollingInterval = interval; // Simpan referensi interval untuk membersihkan nanti
  };

  // Klik tombol proses video
  processVideoBtn.addEventListener("click", async () => {
    console.log("Process button clicked");
    if (selectedFiles.length === 0) {
      showToast("Tidak ada berkas video terpilih atau valid.", true);
      return;
    }

    processVideoBtn.disabled = true;
    // progressBarContainer.style.display = "block"; // Dihapus karena setiap file punya sendiri

    for (let i = 0; i < selectedFiles.length; i++) {
      const fileEntry = selectedFiles[i];
      const file = fileEntry.file;

      // Reset UI untuk file ini (jika diproses ulang atau sebelumnya error)
      fileEntry.progressBarContainerEl.style.display = "none"; // Sembunyikan sampai pemrosesan dimulai
      fileEntry.progressBarEl.style.width = "0%";
      fileEntry.progressBarEl.setAttribute("aria-valuenow", "0");
      fileEntry.progressTextEl.textContent = "0%";
      fileEntry.progressBarEl.classList.add(
        "progress-bar-animated",
        "progress-bar-striped"
      );
      fileEntry.progressBarEl.classList.remove("bg-success"); // Hapus warna hijau jika ada
      fileEntry.downloadLinkEl.style.display = "none"; // Sembunyikan tautan unduh

      showToast(
        `Memulai pemrosesan berkas ${i + 1} dari ${selectedFiles.length}: ${
          file.name
        }...`,
        false
      );

      const formData = new FormData();
      formData.append("video", file);
      formData.append("output_format", outputFormatSelect.value);
      formData.append(
        "compression_crf",
        compressionCrfInput ? compressionCrfInput.value : "23"
      );

      const targetResolution = targetResolutionSelect.value;
      if (targetResolution) {
        formData.append("target_resolution", targetResolution);
      }

      const targetBitrate = targetBitrateSelect.value;
      if (targetBitrate) {
        formData.append("target_bitrate", targetBitrate);
      }

      try {
        console.log(
          `Mengirim permintaan untuk berkas ${file.name} ke backend...`
        );
        const BACKEND_URL = "https://web-konversi.up.railway.app"; // Ganti dengan URL backend Anda
        const response = await fetch(`${BACKEND_URL}/api/process`, {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          fileEntry.task_id = data.task_id; // Simpan task_id
          showToast(
            `Pemrosesan untuk ${file.name} dimulai. ID Tugas: ${data.task_id}`,
            false
          );
          fileEntry.progressBarContainerEl.style.display = "block"; // Tampilkan progress bar
          pollProgress(fileEntry); // Mulai polling progres untuk tugas ini
        } else {
          const errorData = await response.json();
          showToast(
            `Error memulai pemrosesan untuk ${file.name}: ${
              errorData.error || "Error tidak diketahui"
            }`,
            true
          );
          console.error(
            `Processing initiation error for ${file.name}:`,
            errorData
          );
          fileEntry.progressBarContainerEl.style.display = "none"; // Sembunyikan progress bar jika gagal memulai
          // Update status badge menjadi error
          const statusBadgeEl = fileEntry.progressBarEl
            .closest("li")
            .querySelector(".badge");
          if (statusBadgeEl) {
            statusBadgeEl.classList.remove("bg-success");
            statusBadgeEl.classList.add("bg-danger");
            statusBadgeEl.textContent = `Error: ${
              errorData.error || "Tidak diketahui"
            }`;
          }
        }
      } catch (error) {
        showToast(
          `Error jaringan saat memulai pemrosesan untuk ${file.name}: ${error.message}. Harap periksa koneksi Anda.`,
          true
        );
        console.error(`Fetch error for ${file.name}:`, error);
        fileEntry.progressBarContainerEl.style.display = "none"; // Sembunyikan progress bar jika gagal
        // Update status badge menjadi error
        const statusBadgeEl = fileEntry.progressBarEl
          .closest("li")
          .querySelector(".badge");
        if (statusBadgeEl) {
          statusBadgeEl.classList.remove("bg-success");
          statusBadgeEl.classList.add("bg-danger");
          statusBadgeEl.textContent = `Error: ${error.message}`;
        }
      }
    }

    // Setelah semua permintaan awal dikirim, tombol bisa diaktifkan kembali
    // atau mungkin tetap dinonaktifkan sampai semua selesai, tergantung UX yang diinginkan
    // Untuk saat ini, kita akan biarkan tetap nonaktif sampai semua polling selesai
    // Atau kita bisa mengaktifkan kembali jika tidak ada file yang valid.
    if (
      selectedFiles.length === 0 ||
      selectedFiles.every(
        (fe) => fe.status === "Completed" || fe.status === "Failed"
      )
    ) {
      processVideoBtn.disabled = false;
    }
  });

  // Bersihkan interval polling saat keluar dari halaman atau refresh
  window.addEventListener("beforeunload", () => {
    selectedFiles.forEach((fileEntry) => {
      if (fileEntry.pollingInterval) {
        clearInterval(fileEntry.pollingInterval);
      }
    });
  });
});
