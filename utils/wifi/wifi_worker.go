package main

import (
	"encoding/json"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/text/encoding/charmap"
)

// Наша расширенная структура данных (строго по ТЗ)
type WifiData struct {
	Time      string `json:"time"`
	Interface string `json:"interface"`
	SSID      string `json:"ssid"`
	BSSID     string `json:"bssid"`
	Signal    int32  `json:"signal"`
	Channel   int32  `json:"channel"`
	Standard  string `json:"standard"`
	RxRate    int32  `json:"rx_rate"`
	TxRate    int32  `json:"tx_rate"`
	State     string `json:"state"`
}

// Простая структура для чтения интервала
type Config struct {
	IntervalSec string `json:"interval_sec"`
}

func main() {
	// 1. Определяем рабочую директорию демона.
	// Так как он запускается из автозагрузки, os.Getwd() вернет C:\Windows\System32.
	// Поэтому мы явно вычисляем путь к папке, где лежит сам исполняемый файл в %APPDATA%
	exePath, err := os.Executable()
	if err != nil {
		os.Exit(1)
	}
	workDir := filepath.Dir(exePath)

	// Настраиваем системный логгер демона для отладки ошибок
	logFile, _ := os.OpenFile(filepath.Join(workDir, "wifi_daemon.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if logFile != nil {
		log.SetOutput(logFile)
		defer logFile.Close()
	}

	configPath := filepath.Join(workDir, "config.json")
	recordsPath := filepath.Join(workDir, "wifi_records.jsonl")

	for {
		// 2. Читаем актуальные настройки из config.json на каждом шаге цикла
		interval := 5 // дефолтное значение
		cfgData, err := os.ReadFile(configPath)
		if err == nil {
			var cfg Config
			if json.Unmarshal(cfgData, &cfg) == nil {
				if val, err := strconv.Atoi(cfg.IntervalSec); err == nil && val > 0 {
					interval = val
				}
			}
		}

		// 3. Собираем расширенные данные Wi-Fi
		currentData := parseWindowsWifi()

		// 4. Записываем в текстовый jsonl-файл
		jsonData, err := json.Marshal(currentData)
		if err == nil {
			f, err := os.OpenFile(recordsPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
			if err == nil {
				_, _ = io.WriteString(f, string(jsonData)+"\n")
				f.Close()
			}
		}

		// Спим столько секунд, сколько указано в конфиге
		time.Sleep(time.Duration(interval) * time.Second)
	}
}

// Наш надежный парсер netsh без кракозябр
func parseWindowsWifi() WifiData {
	res := WifiData{
		Time:      time.Now().Format("2006-01-02 15:04:05"),
		Interface: "Неизвестно",
		SSID:      "Disconnected",
		BSSID:     "--:--:--:--:--:--",
		Signal:    -100,
		Channel:   0,
		Standard:  "None",
		RxRate:    0,
		TxRate:    0,
		State:     "отключено",
	}

	cmd := exec.Command("netsh", "wlan", "show", "interfaces")

	// ИСПРАВЛЕНО: ЖЕСТКО ЗАПРЕЩАЕМ WINDOWS ПОКАЗЫВАТЬ ОКНО КОНСОЛИ ДЛЯ NETSH
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow: true,
	}

	out, err := cmd.Output()
	if err != nil {
		return res
	}

	decoder := charmap.CodePage866.NewDecoder()
	utf8Bytes, _ := decoder.Bytes(out)
	lines := strings.Split(string(utf8Bytes), "\n")

	for _, line := range lines {
		line = strings.TrimSpace(line)
		parts := strings.SplitN(line, ":", 2)
		if len(parts) < 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])

		switch {
		case key == "Имя" || key == "Name":
			res.Interface = val
		case key == "SSID" || key == "Служба SSID":
			res.SSID = val
		case key == "BSSID" || key == "BSSID-адрес":
			res.BSSID = val
		case key == "Состояние" || key == "State":
			res.State = val
		case key == "Тип радиосети" || key == "Radio type":
			res.Standard = val
		case key == "Канал" || key == "Channel":
			ch, _ := strconv.Atoi(val)
			res.Channel = int32(ch)
		case key == "Прием (Мбит/с)" || key == "Receive rate (Mbps)":
			rate, _ := strconv.Atoi(val)
			res.RxRate = int32(rate)
		case key == "Передача (Мбит/с)" || key == "Transmit rate (Mbps)":
			rate, _ := strconv.Atoi(val)
			res.TxRate = int32(rate)
		case key == "Сигнал" || key == "Signal":
			val = strings.TrimSuffix(val, "%")
			pct, _ := strconv.Atoi(val)
			res.Signal = int32((pct / 2) - 100)
		}
	}
	return res
}
