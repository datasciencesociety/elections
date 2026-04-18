# OCR Protocol Parser

Извлича структурирани данни от OCR-обработени HTML страници на секционни протоколи от парламентарни избори (27.10.2024) и генерира три изходни файла в CIK формат: `protocols.txt`, `votes.txt`, `preferences.txt`.

## Инсталация

```bash
cd elections/ocr-protocol-parser
pip install -r requirements.txt
```

## Употреба

```bash
# Обработка на всички секции
python -m ocr_protocol_parser \
  --html-dir ../../election-results-2024/2024-html \
  --output-dir ./output

# Обработка на една секция
python -m ocr_protocol_parser \
  --html-dir ../../election-results-2024/2024-html \
  --output-dir ./output \
  --section 010100001

# С LLM верификация (опционално)
python -m ocr_protocol_parser \
  --html-dir ../../election-results-2024/2024-html \
  --output-dir ./output \
  --llm-verify \
  --llm-api-key sk-... \
  --llm-model gpt-4o-mini
```

## CLI аргументи

| Аргумент | Задължителен | Описание |
|---|---|---|
| `--html-dir` | да | Път до директорията с HTML папки по секции |
| `--output-dir` | да | Път за изходните файлове |
| `--section` | не | Код на секция за обработка (9 цифри) |
| `--log-level` | не | DEBUG, INFO, WARNING, ERROR (по подразбиране: INFO) |
| `--llm-verify` | не | Включва LLM верификация на извлечените данни |
| `--llm-api-base` | не | API base URL (по подразбиране: env `OPENAI_API_BASE`) |
| `--llm-api-key` | не | API ключ (по подразбиране: env `OPENAI_API_KEY`) |
| `--llm-model` | не | Модел (по подразбиране: `gpt-4o-mini`) |
| `--llm-timeout` | не | Timeout в секунди (по подразбиране: 30) |

## Тестове

```bash
# Всички тестове
python -m pytest . -v

# Само property-based тестове
python -m pytest . -v -k "property"

# Само интеграционни тестове
python -m pytest test_integration.py -v
```

## Поддържани формуляри

| Приложение | Тип | Описание | Страници |
|---|---|---|---|
| 75-НС-х | 24 | Хартия | 8 |
| 76-НС-хм | 26 | Хартия + Машина | 14 |
| 77-НС-чх | 28 | Чужбина хартия | 8 |
| 78-НС-чхм | 30 | Чужбина хартия + машина | 14 |
