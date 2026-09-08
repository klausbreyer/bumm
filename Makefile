.DEFAULT_GOAL := start
.PHONY: prepare start

# Port 4176 is Klaus's development server. Use another port for agent checks.
PORT ?= 4176
OPEN ?= --open

prepare:
	bun install --frozen-lockfile

start: prepare
	./node_modules/.bin/vite --host 127.0.0.1 --port "$(PORT)" --strictPort $(OPEN)
