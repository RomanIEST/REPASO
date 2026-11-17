# Repaso · Examen de Egreso (Ing. en TI)

Aplicación web corriendo en Node.js (sin dependencias externas) para estudiar con el banco de
**344 reactivos de opción múltiple** del Examen General de Egreso.

## Cómo ejecutarla

```bash
npm start
# o directamente:
node server.js
```

Luego abre **http://localhost:3000** en tu navegador. Puerto alternativo: `PORT=8080 npm start`.

El banco de preguntas (`banco_preguntas_examen_egreso.txt`) se parsea al iniciar el servidor;
si editas el archivo, basta con reiniciar el servidor para recargar las preguntas.

## Modos de estudio

| Modo | Descripción |
|---|---|
| **Inicio** | Panel con estadísticas globales, progreso por tema e historial de simulacros. |
| **Estudio** | Practica por tema con retroalimentación inmediata y justificación de cada respuesta. |
| **Prueba por tema** | Evaluación de todo el tema (orden aleatorio) sin pistas; calificación y revisión al final. |
| **Simulacro** | Simulación de examen real: muestra proporcional a todos los temas, temporizador (1.2 min/reactivo por defecto), panel de navegación, marcado de dudas y calificación solo al terminar (>= 60% = aprobado). |
| **Flashcards** | Tarjetas de memoria: piensa la respuesta, voltea la tarjeta y autoevalúate. |
| **Repaso de fallos** | Lista de los reactivos que has fallado en cualquier modo; acertarlos los elimina de la lista. |
| **Buscar** | Buscador por palabra clave sobre enunciados y opciones. |

## Funciones útiles

- **Progreso persistente** en el navegador (localStorage): aciertos/errores por reactivo, lista de fallos e historial de simulacros.
- **Atajos de teclado**: `A`–`D` o `1`–`4` para responder, `←`/`→` para navegar, `F` para marcar duda, `Enter` para siguiente (en estudio).
- **Contexto de datos**: en Bases de Datos se muestra el esquema SQL / colección MongoDB en un panel colapsable.
- **Bloqueo de respuestas en exámenes**: las sesiones de prueba/simulacro se califican en el servidor, sin revelar claves durante el examen.
- **Muestreo proporcional**: el simulacro reparte los reactivos según el peso real de cada tema (p. ej. 100 reactivos ≈ 15 Programación, 13 Redes, 13 IA, 10 Web…).

## Estructura

```
├── server.js        → servidor HTTP (API + estáticos), cero dependencias
├── lib/parser.js    → parsea el banco de preguntas y las claves del archivo .txt
├── public/          → frontend (HTML/CSS/JS, sin frameworks)
└── banco_preguntas_examen_egreso.txt   → fuente de datos (344 reactivos)
```

## API (resumen)

- `GET /api/topics` — temas y conteos
- `GET /api/questions?topic=PROG` — reactivos de un tema (`&withAnswers=0` oculta claves)
- `GET /api/search?q=texto` — buscador
- `POST /api/session/start` — crea prueba/simulacro (`mode`, `topic`/`topics`, `count`, `minutes`)
- `POST /api/session/:id/grade` — califica y devuelve resultados con justificación (la sesión se consume)
