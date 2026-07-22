# Critical Error Handling in Baileys

Библиотека Baileys работает через нестабильное веб-сокет соединение. Правильная обработка ошибок разъединения (`DisconnectReason`) — ключ к стабильности 24/7.

## Коды ошибок и Реакция Системы

### 401: Unauthorized (Logged Out)
**Причина:** Пользователь отозвал сессию с телефона (нажал "Выйти со всех устройств") или WhatsApp принудительно инвалидировал сессию.
**Действие системы:** 
- Уничтожить инстанс сокета.
- Удалить папку с авторизационными данными (папка сессии).
- Пометить аккаунт в БД как `status = 'offline'`.
- Уведомить фронтенд для перегенерации нового QR-кода.

### 403: Forbidden (Banned)
**Причина:** Аккаунт заблокирован за спам алгоритмами Meta.
**Действие системы:**
- КРИТИЧЕСКИ ВАЖНО: Не пытаться переподключиться (это убьет другие аккаунты на этом IP).
- Пометить аккаунт в БД как `status = 'banned'`.
- Оповестить пользователя красным Toast-уведомлением.
- Исключить номер из всех пулов рассылки и прогрева.

### 408 / 411: Request Timeout / Client Too Old
**Причина:** Проблема с интернетом или задержки на серверах WA. 
**Действие системы:**
- Экспоненциальный бэкофф (Exponential Backoff). 
- Повторная попытка подключения через 5 секунд, затем 10, затем 30.

### 428: Precondition Required / Connection Closed
**Причина:** Соединение закрыто сервером из-за неактивности или смены узла.
**Действие системы:**
- Безопасный рестарт. Если `shouldReconnect` равно `true`, инициализировать `makeWASocket` заново с существующими кредами.

### 500 / 503: Internal Server Error / Service Unavailable
**Причина:** Глобальный сбой инфраструктуры Meta.
**Действие системы:**
- Поставить все рассылки на паузу.
- Пытаться переподключиться не чаще чем раз в 2-5 минут, чтобы не попасть под rate-limit.

## Пример кода обработки (Connection Update)

```javascript
sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if(connection === 'close') {
        const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        const isBanned = (lastDisconnect.error)?.output?.statusCode === 403;
        
        if (isBanned) {
            console.error('ACCOUNT BANNED!');
            // Логика обработки бана
        } else if(shouldReconnect) {
            // Реконнект
            connectToWhatsApp();
        } else {
            // Очистка сессии (Logged Out)
            clearSession();
        }
    }
});
```
