**TikTok Autoposter**

tiktok-uploader \+ Indigo X | Инструкция для разработчика

*MVP Контент-Завод | Python \+ Selenium | Бесплатно*

# **1\. Как это работает**

tiktok-uploader использует Selenium для управления браузером. Вместо обычного Chrome — подключаемся к Indigo X профилю через CDP порт. TikTok видит нативный fingerprint антидетект браузера с правильным прокси.

Контент-завод генерирует video.mp4 \+ meta.json  
        ↓  
Python скрипт запускает Indigo X профиль через API  
        ↓  
tiktok-uploader подключается к Indigo через CDP порт  
        ↓  
TikTok видит: нативный браузер \+ USA прокси \+ правильный fingerprint  
        ↓  
Видео публикуется → профиль закрывается  
        ↓  
Telegram алерт с результатом

| Компонент | Роль | Стоимость |
| :---- | :---- | :---- |
| tiktok-uploader | Постинг видео через Selenium | Бесплатно |
| Indigo X | Антидетект браузер с fingerprint и прокси | По тарифу |
| NodeMaven | USA мобильный прокси | По тарифу |
| Python 3.10+ | Язык автоматизации | Бесплатно |
| Selenium | Управление браузером | Бесплатно |

# **2\. Установка зависимостей**

\# Основные зависимости  
pip install tiktok-uploader  
pip install selenium  
pip install requests  
pip install watchdog

\# Проверка  
python \-c "from tiktok\_uploader.upload import upload\_video; print('OK')"

*tiktok-uploader требует Chrome или Chromium. Indigo X использует Chromium внутри — отдельно устанавливать не нужно.*

# **3\. Настройка Indigo X профиля под TikTok**

Каждый TikTok аккаунт должен иметь свой Indigo X профиль с мобильным fingerprint.

## **3.1 Создание профиля через API**

import hashlib, requests, json

INDIGO\_API \= 'https://api.indigobrowser.com'

def get\_indigo\_token(email, password):  
    r \= requests.post(f'{INDIGO\_API}/user/signin', json={  
        'email': email,  
        'password': hashlib.md5(password.encode()).hexdigest()  
    })  
    return r.json()\['data'\]\['token'\]

def create\_tiktok\_profile(name, proxy\_config, token):  
    headers \= {'Authorization': f'Bearer {token}'}  
    config \= {  
        'name': name,  
        'platform': 'mobile',  
        'os': 'Android',  
        \# Android UA — TikTok думает что это телефон  
        'userAgent': ('Mozilla/5.0 (Linux; Android 14; Pixel 8\) '  
                      'AppleWebKit/537.36 (KHTML, like Gecko) '  
                      'Chrome/120.0.0.0 Mobile Safari/537.36'),  
        'resolution':   {'width': 412, 'height': 915},  
        'language':     'en-US',  
        'timezone':     'America/New\_York',  
        'touchEnabled': True,  
        'proxy':        proxy\_config  
    }  
    r \= requests.post(f'{INDIGO\_API}/profile/create',  
                      json=config, headers=headers)  
    return r.json()\['id'\]

\# Конфиг прокси NodeMaven  
proxy \= {  
    'type': 'http',  
    'host': 'gate.nodemaven.com',  
    'port': 8080,  
    'username': 'user-country-US-state-NewYork',  
    'password': 'твой\_пароль\_nodemaven'  
}

token     \= get\_indigo\_token('твой@email.com', 'пароль\_indigo')  
profile\_id \= create\_tiktok\_profile('TikTok\_US\_01', proxy, token)  
print(f'Профиль создан: {profile\_id}')

## **3.2 Первый вход в TikTok (делается один раз вручную)**

import requests, hashlib  
from selenium import webdriver  
from selenium.webdriver.chrome.options import Options

INDIGO\_LAUNCHER \= 'https://launcher.indigobrowser.com:45001'

def start\_indigo\_profile(profile\_id, token):  
    r \= requests.get(  
        f'{INDIGO\_LAUNCHER}/api/v2/profile/start?automation=true\&id={profile\_id}',  
        headers={'Authorization': f'Bearer {token}'}  
    )  
    return r.json()\['value'\]  \# CDP порт

def stop\_indigo\_profile(profile\_id, token):  
    requests.get(  
        f'{INDIGO\_LAUNCHER}/api/v2/profile/stop?id={profile\_id}',  
        headers={'Authorization': f'Bearer {token}'}  
    )

\# Запустить профиль  
token \= get\_indigo\_token('email', 'password')  
port  \= start\_indigo\_profile(profile\_id, token)

\# Открыть TikTok в браузере Indigo  
options \= Options()  
options.add\_experimental\_option('debuggerAddress', f'127.0.0.1:{port}')  
driver \= webdriver.Chrome(options=options)  
driver.get('https://www.tiktok.com/login')

\# \!\! Залогиниться ВРУЧНУЮ в открывшемся браузере \!\!  
input('Залогинься в TikTok вручную, потом нажми Enter...')

\# Сохранить cookies  
cookies \= driver.get\_cookies()  
with open(f'cookies\_{profile\_id}.json', 'w') as f:  
    import json  
    json.dump(cookies, f)  
print('Cookies сохранены\!')

driver.quit()  
stop\_indigo\_profile(profile\_id, token)

**Первый логин делается один раз вручную. Cookies сохраняются и дальше используются для автоматического постинга без повторного логина.**

# **4\. Автопостинг через tiktok-uploader \+ Indigo X**

from tiktok\_uploader.upload import upload\_video  
from selenium.webdriver.chrome.options import Options  
import requests, hashlib, json, time, random

INDIGO\_API      \= 'https://api.indigobrowser.com'  
INDIGO\_LAUNCHER \= 'https://launcher.indigobrowser.com:45001'

\# Маппинг аккаунтов  
TIKTOK\_ACCOUNTS \= {  
    'TikTok\_US\_01': {  
        'profile\_id':  'indigo\_profile\_id\_1',  
        'cookies\_file': 'cookies\_tt\_01.json',  
    },  
    'TikTok\_US\_02': {  
        'profile\_id':  'indigo\_profile\_id\_2',  
        'cookies\_file': 'cookies\_tt\_02.json',  
    },  
}

\# Ротация аккаунтов  
account\_index \= 0

def get\_next\_account():  
    global account\_index  
    accounts \= list(TIKTOK\_ACCOUNTS.keys())  
    acc \= accounts\[account\_index % len(accounts)\]  
    account\_index \+= 1  
    return acc, TIKTOK\_ACCOUNTS\[acc\]

def post\_tiktok(video\_path: str, caption: str):  
    acc\_name, acc \= get\_next\_account()  
    profile\_id   \= acc\['profile\_id'\]  
    cookies\_file \= acc\['cookies\_file'\]

    print(f'Постим с аккаунта: {acc\_name}')

    \# Получаем токен Indigo  
    token \= get\_indigo\_token('email', 'password')

    \# Запускаем Indigo профиль  
    r \= requests.get(  
        f'{INDIGO\_LAUNCHER}/api/v2/profile/start?automation=true\&id={profile\_id}',  
        headers={'Authorization': f'Bearer {token}'}  
    )  
    port \= r.json()\['value'\]  
    print(f'Indigo профиль запущен на порту: {port}')

    try:  
        \# Загружаем cookies  
        with open(cookies\_file) as f:  
            cookies\_list \= json.load(f)

        \# Опции для подключения к Indigo X  
        options \= Options()  
        options.add\_experimental\_option(  
            'debuggerAddress', f'127.0.0.1:{port}'  
        )

        \# Случайная пауза перед постингом  
        time.sleep(random.uniform(30, 90))

        \# Постим видео  
        upload\_video(  
            video\_path,  
            description=caption,  
            cookies\_list=cookies\_list,  
            options=options  
        )  
        print(f'✅ TikTok опубликован с {acc\_name}')  
        return True

    except Exception as e:  
        print(f'❌ Ошибка постинга TikTok: {e}')  
        return False

    finally:  
        \# Всегда закрываем профиль  
        requests.get(  
            f'{INDIGO\_LAUNCHER}/api/v2/profile/stop?id={profile\_id}',  
            headers={'Authorization': f'Bearer {token}'}  
        )  
        print('Indigo профиль закрыт')

# **5\. Интеграция с контент-заводом (Watchdog)**

from watchdog.observers import Observer  
from watchdog.events import FileSystemEventHandler  
from pathlib import Path  
import json, time, random, requests

BOT\_TOKEN \= 'TELEGRAM\_BOT\_TOKEN'  
CHAT\_ID   \= 'TELEGRAM\_CHAT\_ID'

def send\_telegram(msg):  
    requests.post(  
        f'https://api.telegram.org/bot{BOT\_TOKEN}/sendMessage',  
        json={'chat\_id': CHAT\_ID, 'text': msg}  
    )

class TikTokHandler(FileSystemEventHandler):  
    def on\_created(self, event):  
        if not event.src\_path.endswith('.mp4'):  
            return

        video\_path \= event.src\_path  
        json\_path  \= video\_path.replace('.mp4', '.json')

        \# Ждём JSON  
        for \_ in range(15):  
            if Path(json\_path).exists(): break  
            time.sleep(2)  
        else:  
            send\_telegram(f'⚠️ JSON не найден: {video\_path}')  
            return

        with open(json\_path) as f:  
            meta \= json.load(f)

        caption \= meta\['description'\] \+ ' ' \+ ' '.join(meta\['hashtags'\])

        send\_telegram(f'📥 Новое видео TikTok: {meta\["title"\]\[:50\]}')

        \# Случайная пауза  
        time.sleep(random.uniform(60, 180))

        success \= post\_tiktok(video\_path, caption)

        if success:  
            send\_telegram('✅ TikTok видео опубликовано\!')  
        else:  
            send\_telegram('❌ Ошибка публикации TikTok')

\# Запуск  
observer \= Observer()  
observer.schedule(TikTokHandler(), '/incoming\_videos/tiktok/', recursive=False)  
observer.start()  
print('Watchdog TikTok запущен')  
try:  
    while True: time.sleep(1)  
except KeyboardInterrupt:  
    observer.stop()

# **6\. Правила снижения рисков бана**

| Правило | Реализация | Приоритет |
| :---- | :---- | :---- |
| Мобильный 4G прокси | NodeMaven USA в Indigo профиле | 🔴 Критично |
| Android fingerprint в Indigo | Mobile UA \+ touch events | 🔴 Критично |
| Cookies вместо логина | Сохранить один раз, использовать всегда | 🔴 Критично |
| Прогрев аккаунта 14 дней | Перед первым постом — просмотры и лайки | 🔴 Критично |
| 1-2 поста в день максимум | Ротация между аккаунтами | 🟡 Важно |
| Случайные паузы | random.uniform(30, 90\) перед постингом | 🟡 Важно |
| Один профиль \= один аккаунт | Никогда не смешивать | 🔴 Критично |
| Не менять прокси | Один прокси на весь срок жизни | 🔴 Критично |

*При соблюдении всех правил риск бана за 30 дней: \~10-20%. TikTok агрессивнее Instagram, но правильная связка Indigo \+ мобильный прокси \+ aged аккаунт даёт хорошую защиту.*

# **7\. Ежедневный цикл работы**

07:00  →  Прогрев аккаунтов через Indigo X (скрипт прогрева)  
           5-7 минут просмотров, лайков, поиска

08:00+ →  Watchdog следит за /incoming\_videos/tiktok/  
           Как только падает видео → пауза → постинг

Весь день →  Ротация между TikTok\_US\_01 и TikTok\_US\_02  
              Максимум 1-2 поста на аккаунт в день

23:55  →  Telegram отчёт: сколько опубликовано, ошибки

# **8\. Что нужно для старта**

| Параметр | Значение / Действие |
| :---- | :---- |
| Indigo X аккаунт | Логин и пароль от Indigo X |
| Indigo X профили | Создать 2 профиля для TikTok (Android UA, USA прокси) |
| NodeMaven прокси | 2 USA мобильных прокси (по одному на профиль) |
| TikTok аккаунты | 2 aged USA аккаунта — залогиниться вручную один раз |
| Cookies | Сохранить после первого ручного логина |
| Python 3.10+ | pip install tiktok-uploader selenium watchdog requests |
| GitHub библиотека | github.com/wkaisertexas/tiktok-uploader |

# **9\. Итоговая схема**

┌─────────────────────────────────────────────┐  
│           КОНТЕНТ-ЗАВОД                     │  
│  video.mp4 \+ meta.json → /incoming\_videos/  │  
└──────────────────┬──────────────────────────┘  
                   │  
                   ▼  
┌─────────────────────────────────────────────┐  
│         PYTHON ОРКЕСТРАТОР                  │  
│  Watchdog видит новый файл                  │  
│  Выбирает следующий аккаунт (ротация)       │  
│  Пауза random(60, 180\) сек                  │  
└──────────────────┬──────────────────────────┘  
                   │  
                   ▼  
┌─────────────────────────────────────────────┐  
│      INDIGO X API                           │  
│  Запускает профиль TikTok\_US\_01             │  
│  Отдаёт CDP порт для Selenium               │  
└──────────────────┬──────────────────────────┘  
                   │ CDP порт  
                   ▼  
┌─────────────────────────────────────────────┐  
│      tiktok-uploader (Selenium)             │  
│  Подключается к Indigo браузеру             │  
│  Загружает cookies → открывает TikTok       │  
│  Публикует видео                            │  
└──────────────────┬──────────────────────────┘  
                   │  
                   ▼  
          Telegram алерт ✅

*TikTok Autoposter | tiktok-uploader \+ Indigo X | MVP Контент-Завод*