package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath" // Необходим для сборки путей к файлам
	"syscall"
	"unsafe"

	"GoOverseer/tray"
	"GoOverseer/web"
)

var (
	modkernel32     = syscall.NewLazyDLL("kernel32.dll")
	procCreateMutex = modkernel32.NewProc("CreateMutexW")
)

// Проверяет, занят ли конкретный порт первой копией через проверку системного мутекса
func tryCaptureMutexForPort(port int) (syscall.Handle, bool) {
	mutexNameStr := fmt.Sprintf("Global\\GoOverseer_Mutex_%d", port)
	mutexName, err := syscall.UTF16PtrFromString(mutexNameStr)
	if err != nil {
		return 0, false
	}

	ret, _, err := procCreateMutex.Call(0, 1, uintptr(unsafe.Pointer(mutexName)))
	hMutex := syscall.Handle(ret)

	if err != nil && err.(syscall.Errno) == 183 {
		if hMutex != 0 {
			_ = syscall.CloseHandle(hMutex)
		}
		return 0, false
	}

	return hMutex, true
}

// Инициализирует и проверяет рабочую папку в %APPDATA%
func initAppData() (string, error) {
	appDataDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("не удалось определить путь к AppData: %v", err)
	}

	goOverseerDir := filepath.Join(appDataDir, "GoOverseer")

	// Проверяем наличие папки. Если её НЕТ — создаем один раз.
	if _, err := os.Stat(goOverseerDir); os.IsNotExist(err) {
		err = os.MkdirAll(goOverseerDir, 0755)
		if err != nil {
			return "", fmt.Errorf("не удалось создать папку в AppData: %v", err)
		}
		log.Printf("Зафиксирован первый запуск. Создана рабочая директория: %s", goOverseerDir)
	}

	// Быстрый тест на чтение/запись
	testFile := filepath.Join(goOverseerDir, ".write_test")
	err = os.WriteFile(testFile, []byte("test"), 0644)
	if err != nil {
		return "", fmt.Errorf("ошибка проверки прав записи в AppData: %v", err)
	}

	_, err = os.ReadFile(testFile)
	if err != nil {
		return "", fmt.Errorf("ошибка проверки прав чтения в AppData: %v", err)
	}

	_ = os.Remove(testFile)

	return goOverseerDir, nil
}

func main() {
	log.Println("Инициализация окружения GoOverseer...")

	// Вызываем проверку папки AppData при старте программы
	appDataPath, err := initAppData()
	if err != nil {
		log.Fatalf("Критическая ошибка инициализации системы: %v", err)
	}
	log.Printf("Системный плацдарм готов: %s", appDataPath)

	var activeHandle syscall.Handle
	var runningPort int = 0
	var isFirstInstance bool = false

	// ЗАЩИТА ПРИ СТАРТЕ: Сканируем мутексы Windows, чтобы найти живую первую копию
	for port := 8080; port <= 8090; port++ {
		hMutex, success := tryCaptureMutexForPort(port)
		if !success {
			runningPort = port
			break
		}

		if port == 8080 && success {
			activeHandle = hMutex
			runningPort = port
			isFirstInstance = true
			break
		}

		if success {
			activeHandle = hMutex
			runningPort = port
			isFirstInstance = true
			break
		}
	}

	// Если мы ВТОРАЯ копия — просто тихо закрываемся
	if !isFirstInstance && runningPort > 0 {
		log.Printf("GoOverseer уже запущен на порту %d. Завершение работы копии.", runningPort)
		os.Exit(0)
	}

	defer func() {
		if activeHandle != 0 {
			_ = syscall.CloseHandle(activeHandle)
		}
	}()

	// МЫ ПЕРВАЯ КОПИЯ — продолжаем штатный запуск сервера строго на найденном свободном порту
	mainCtx, cancelAll := context.WithCancel(context.Background())
	defer cancelAll()

	mux := web.SetupHandlers(cancelAll)
	srv := web.NewServer(mux)

	serverURL, err := srv.StartOnPort(runningPort)
	if err != nil {
		log.Fatalf("Ошибка инициализации сервера: %v", err)
	}

	// Достаем байты иконки из встроенной статики
	staticFS := web.GetStaticFS()
	iconFile, err := staticFS.Open("assets/overseer.png")
	var iconBytes []byte
	if err != nil {
		log.Printf("Предупреждение: не удалось найти overseer.png (%v)", err)
	} else {
		iconBytes, _ = io.ReadAll(iconFile)
		iconFile.Close()
	}

	// Настраиваем и запускаем системный трей
	t := tray.InitTray(serverURL, iconBytes, cancelAll)

	// Системные прерывания (Ctrl+C)
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		select {
		case sig := <-sigChan:
			log.Printf("Получен системный сигнал прерывания (%v).", sig)
		case <-mainCtx.Done():
			log.Println("Получена команда закрытия программы.")
		}
		t.Remove()
	}()

	log.Println("Запуск платформенного цикла обработки сообщений Windows...")
	if err := t.Run(); err != nil {
		log.Printf("Ошибка работы системного трея: %v", err)
	}

	if err := srv.Shutdown(); err != nil {
		log.Printf("Ошибка при остановке сервера: %v", err)
	}

	log.Println("GoOverseer успешно завершил свою работу.")
}
