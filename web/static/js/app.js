// Функция плавного выключения всего оркестратора
function shutdownServer() {
    if (confirm("Вы уверены, что хотите полностью остановить оркестратор и закрыть сервер?")) {
        fetch('/api/shutdown', { method: 'POST' })
            .then(() => {
                alert("Оркестратор остановлен. Окно можно закрыть.");
                window.close();
            });
    }
}

// Запуск сканирования и построения интерфейса при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
    loadUtilities();
});

function loadUtilities() {
    const container = document.getElementById("utils-container");

    fetch('/api/utils')
        .then(response => response.json())
        .then(utils => {
            container.innerHTML = ""; // Очищаем спиннер загрузки

            if (utils.length === 0) {
                container.innerHTML = `<div class="col w-100 text-center text-muted">Доступные утилиты в папке utils/ не обнаружены.</div>`;
                return;
            }

            utils.forEach(util => {
                // Создаем колонку для карточки утилиты
                const col = document.createElement("div");
                col.className = "col-12";

                // Настраиваем стили и элементы в зависимости от статуса активности утилиты
                let statusBadge = `<span class="badge bg-secondary">Не активен</span>`;
                let actionButton = `<button class="btn btn-success" onclick="activateUtil('${util.id}')">Активировать модуль</button>`;
                let settingsBlock = ""; // По умолчанию блок настроек пустой (не показывается)

                if (util.active) {
                    statusBadge = `<span class="badge bg-success">Активен (В автозагрузке)</span>`;
                    
                    // Проверяем, задан ли у утилиты тип отображения аналитики
                    let viewButton = "";
                    if (util.view_type && util.view_type !== "") {
                        viewButton = `<a href="/utils/view?id=${util.id}" class="btn btn-primary">Панель аналитики</a>`;
                    }

                    // Формируем две аккуратные кнопки по вашему ТЗ
                    actionButton = `
                        <div class="d-flex gap-2">
                            ${viewButton}
                            <button class="btn btn-outline-danger" onclick="deactivateUtil('${util.id}')">Деактивировать модуль</button>
                        </div>
                    `;
                }


                // Собираем Bootstrap-карточку утилиты
                col.innerHTML = `
                    <div class="card shadow-sm border border-translucent">
                        <div class="card-body p-4">
                            <div class="d-flex justify-content-between align-items-start mb-3">
                                <div>
                                    <h4 class="card-title fw-bold m-0 d-flex align-items-center">
                                        ${util.name}
                                        <div class="ms-3">${statusBadge}</div>
                                    </h4>
                                    <p class="card-text text-muted mt-2">${util.description}</p>
                                </div>
                                <div>
                                    ${actionButton}
                                </div>
                            </div>
                            <div class="text-muted small">
                                <span>Файл логов: <code class="text-info">${util.log_file}</code></span>
                                <span class="ms-4">Процесс Windows: <code class="text-warning">${util.exe_name}</code></span>
                            </div>
                        </div>
                        ${settingsBlock}
                    </div>
                `;

                container.appendChild(col);
            });
        })
        .catch(err => {
            container.innerHTML = `<div class="col w-100 text-center text-danger">Ошибка получения данных от сервера: ${err}</div>`;
        });
}


// Функция активации модуля
function activateUtil(id) {
    fetch(`/api/utils/activate?id=${id}`, { method: 'POST' })
        .then(res => {
            if (res.ok) {
                loadUtilities(); // Перезагружаем карточки, чтобы раскрыть форму настроек
            } else {
                alert("Ошибка при активации модуля");
            }
        });
}
// Функция деактивации модуля
function deactivateUtil(id) {
    if (confirm("Вы уверены, что хотите полностью выключить модуль и УДАЛИТЬ все его логи с компьютера?")) {
        fetch(`/api/utils/deactivate?id=${id}`, { method: 'POST' })
            .then(res => {
                if (res.ok) {
                    loadUtilities(); // Перезагружаем карточки, пряча форму настроек
                } else {
                    alert("Ошибка при деактивации модуля");
                }
            });
    }
}
// Заглушка для сохранения настроек
// Функция сбора полей формы и отправки настроек на сервер
function saveSettings(id) {
    // Находим все элементы input на странице, чьи ID начинаются с префикса конфигурации нашей утилиты
    const inputs = document.querySelectorAll(`input[id^="cfg_${id}_"]`);
    const newSettings = {};

    inputs.forEach(input => {
        // Отрезаем префикс "cfg_WIFI_", чтобы получить чистый системный ключ параметра (например, "interval_sec")
        const key = input.id.replace(`cfg_${id}_`, "");
        newSettings[key] = input.value;
    });

    // Отправляем JSON со всеми полями настроек на бэкенд
    fetch(`/api/utils/save?id=${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
    })
    .then(res => {
        if (res.ok) {
            alert("Конфигурация демона успешно сохранена и применена на лету!");
            loadUtilities(); // Мягко обновляем данные карточки на экране
        } else {
            alert("Не удалось сохранить настройки. Проверьте логи сервера.");
        }
    })
    .catch(err => alert("Ошибка отправки данных: " + err));
}

