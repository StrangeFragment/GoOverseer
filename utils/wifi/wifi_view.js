let wifiChartInstance = null;
let lastRenderedTimestamp = "";

// Стартуем опрос при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
    initWifiChart();
    refreshWifiAnalytics();
    // Проверяем обновления каждые 3 секунды
    setInterval(refreshWifiAnalytics, 3000);
});

function initWifiChart() {
    const ctx = document.getElementById('wifiSignalChart');
    if (!ctx || typeof Chart === 'undefined') return;

    wifiChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Уровень сигнала (dBm)',
                data: [],
                borderColor: '#0d6efd',
                backgroundColor: 'rgba(13, 110, 253, 0.05)',
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.2, // Плавное сглаживание
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    min: -100, 
                    max: -30,
                    title: { display: true, text: 'dBm (ближе к 0 — лучше)' }
                },
                x: {
                    title: { display: true, text: 'Время замеров' }
                }
            }
        }
    });
}


function refreshWifiAnalytics() {
    // Считываем id и СРАЗУ переводим его в нижний регистр ("WIFI" -> "wifi")
    const rawId = new URLSearchParams(window.location.search).get('id');
    const id = rawId ? rawId.toLowerCase() : "wifi";

    // Отрисовка полей конфигурации
    const fieldsContainer = document.getElementById("wifi-custom-config-fields");
    if (fieldsContainer && fieldsContainer.children.length === 0) {
        fieldsContainer.innerHTML = `
            <div class="mb-3 col-md-6">
                <label class="form-label text-light small fw-bold">Интервал опроса адаптера (сек)</label>
                <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary" id="cfg_live_interval_sec" value="5">
            </div>
            <div class="mb-3 col-md-6">
                <label class="form-label text-light small fw-bold">Порог фиксации изменения сигнала (dBm)</label>
                <input type="number" class="form-control form-control-sm bg-dark text-light border-secondary" id="cfg_live_min_signal_drop_dbm" value="5">
            </div>
        `;
        
        fetch(`/api/utils`)
            .then(res => res.json())
            .then(utils => {
                const wifi = utils.find(u => u.id === id);
                if (wifi && wifi.settings) {
                    if (wifi.settings.interval_sec) document.getElementById("cfg_live_interval_sec").value = wifi.settings.interval_sec;
                    if (wifi.settings.min_signal_drop_dbm) document.getElementById("cfg_live_min_signal_drop_dbm").value = wifi.settings.min_signal_drop_dbm;
                }
            });
    }

    // Загрузка логов истории
    fetch(`/api/utils/logs?id=${id}`)
        .then(res => res.json())
        .then(data => {
            if (data.length > 0) {
                const latestEntry = data[data.length - 1];
                // Рендерим, если пришло новое время ИЛИ если это самый первый запуск страницы
                if (latestEntry.time !== lastRenderedTimestamp || lastRenderedTimestamp === "") {
                    renderAnalytics(data);
                }
            } else {
                renderAnalytics([]);
            }
        });

}

function renderAnalytics(data) {
    const tableBody = document.getElementById("wifi-log-table-body");
    if (!tableBody || !wifiChartInstance) return;
    
    // === АБСОЛЮТНО БЕЗОПАСНОЕ ОБНОВЛЕНИЕ КАРТОЧЕК ===
    if (data && data.length > 0) {
        const latestEntry = data[data.length - 1];
        
        const elSsid = document.getElementById("card-ssid");
        const elBssid = document.getElementById("card-bssid");
        const elChannel = document.getElementById("card-channel");
        const elSignal = document.getElementById("card-signal");

        if (elSsid) elSsid.innerText = latestEntry.ssid || "Disconnected";
        if (elBssid) elBssid.innerText = latestEntry.bssid || "—";
        if (elChannel) elChannel.innerText = latestEntry.channel ?? "—";
        
        if (elSignal) {
            elSignal.innerText = `${latestEntry.signal ?? -100} dBm`;
            elSignal.className = "mb-0 fw-bold"; // Сброс
            if (latestEntry.ssid === "Disconnected") {
                elSignal.classList.add("text-danger");
            } else if (latestEntry.signal >= -65) {
                elSignal.classList.add("text-success");
            } else {
                elSignal.classList.add("text-warning");
            }
        }
    }
    // ===============================================


    tableBody.innerHTML = "";

    if (data.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Логи пока пусты...</td></tr>`;
        return;
    }

    // А. ОБНОВЛЯЕМ ГРАФИК CHART.JS
    wifiChartInstance.data.labels = [];
    wifiChartInstance.data.datasets[0].data = [];

    // Берем последние 40 точек для вывода на график, чтобы не сжимать шкалу
    const chartPoints = data.slice(-40);
    chartPoints.forEach(entry => {
        wifiChartInstance.data.labels.push(entry.time.split(" ")[1]); // Только ЧЧ:ММ:СС
        wifiChartInstance.data.datasets[0].data.push(entry.signal);
    });
    wifiChartInstance.update();

    // Б. ЗАПОЛНЯЕМ ТАБЛИЦУ (Свежие строки наверх)
    const reversedData = [...data].reverse();
    reversedData.forEach(entry => {
        let rowClass = entry.ssid === "Disconnected" ? "table-danger" : (entry.signal >= -65 ? "table-success" : "table-warning");

        tableBody.innerHTML += `
            <tr class="${rowClass}">
                <td><code>${entry.time}</code></td>
                <td><strong>${entry.ssid}</strong></td>
                <td><code>${entry.bssid}</code></td>
                <td><span class="badge bg-dark">${entry.channel}</span></td>
                <td><small>${entry.standard}</small></td>
                <td><small>⬇${entry.rx_rate} / ⬆${entry.tx_rate} Мб</small></td>
                <td><strong>${entry.signal} dBm</strong></td>
            </tr>
        `;
    });

    lastRenderedTimestamp = data[data.length - 1].time;
}

function saveWifiSettings() {
    const id = new URLSearchParams(window.location.search).get('id');
    const newSettings = {
        interval_sec: document.getElementById("cfg_live_interval_sec").value,
        min_signal_drop_dbm: document.getElementById("cfg_live_min_signal_drop_dbm").value
    };

    fetch(`/api/utils/save?id=${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
    }).then(res => {
        if (res.ok) { alert("Конфигурация успешно сохранена!"); refreshWifiAnalytics(); }
    });
}
