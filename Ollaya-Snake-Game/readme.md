# Ollaya Snake — Semantic Reflex Layer demo

This game demonstrates a **Jev clone working as a Semantic Reflex Layer**: a fast, bounded System 1 loop between structured perception (the Snake board state) and game control. Ollaya selects a semantic behavior for the current state; the game’s planner and safety checks turn that behavior into a legal direction and advance the game. Ollaya does not directly control the game’s physics.

## Run with Docker

Requirements: Docker with the Compose plugin, and an Ollaya service reachable from the Docker host.

```sh
cp -n .env.example .env
# Edit .env if your Ollaya endpoint, model, or authentication differs.
docker compose up --build
```

Open <http://localhost:8787>. To stop the app, press `Ctrl+C`, or run `docker compose down` in another terminal.

If host port `8787` is already in use, start it on another port, for example `PORT=18787 docker compose up --build`, and open <http://localhost:18787>.

The Compose setup points the container at `host.docker.internal:11435`, the Ollaya service running on the Docker host. If Ollaya is hosted elsewhere, set `OLLAYA_API_URL` in `.env` to an address reachable from the container. `PORT` controls both the container listener and published host port.

If you already have a `.env` for running the server directly on your machine, check `OLLAYA_API_URL` before starting Docker: `127.0.0.1` inside a container means the container itself. Use `http://host.docker.internal:11435/v1/systemone` to reach Ollaya on the Docker host.

The OpenAI key is optional. Without it, gameplay and Ollaya decisions still work; the death-triggered rule-evolution request returns a configuration error until `OPENAI_API_KEY` is set and the container is restarted.

## Run without Docker

Requires Node.js 18 or newer (the server uses the built-in `fetch` API).

```sh
cp -n .env.example .env
node server.js
```

Then open <http://localhost:8787>. The server reads `.env` from this directory. For a locally running Ollaya service, change `OLLAYA_API_URL` to its local endpoint (commonly `http://127.0.0.1:11435/v1/systemone`).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Web server port (also the Docker host port). |
| `OLLAYA_API_URL` | Docker: `http://host.docker.internal:11435/v1/systemone`; native: `http://127.0.0.1:11435/v1/systemone` | Ollaya System 1 decision endpoint. |
| `OLLAYA_MODEL` | `laya` | Decision model sent to Ollaya. |
| `OLLAYA_API_TOKEN` | empty | Optional bearer token for the Ollaya endpoint. |
| `OPENAI_API_KEY` | empty | Optional credential for the slower GPT-based rule-evolution path. Keep this server-side. |

## How the reflex layer works

The demo adapts the control hierarchy from the Semantic Reflex Layer concept brief:

1. **Structured state / perception:** the game computes a compact board state: food safety and distance, available space, escape routes, pressure, tail reachability, and legal-move properties.
2. **System 1 / semantic reflex:** the server sends this state to Ollaya with a bounded choice among `food`, `tail`, `space`, and `cycle`. Ollaya returns one semantic mode rather than a trajectory or low-level control signal. The selected mode and decision stream are visible in the control room.
3. **Planner / controller:** the browser’s local game logic maps the chosen mode to a candidate direction and checks it against legal directions and the live board. The loop waits for each Ollaya response before another decision is accepted; its launch rate is configurable in the UI.
4. **Environment / feedback:** the game advances, then the next board state becomes the next decision input. Keyboard controls are also available when Ollaya control is switched off.

This keeps the fast loop bounded and inspectable: **state → Ollaya → semantic mode → local controller → game → feedback**. The game engine remains responsible for collision rules and movement; the model is not asked to simulate physics.

### Slower rule-evolution path

After a game ends, the player can review the failure, enter a reflection and proposed fix, and ask the optional OpenAI-backed endpoint to propose a new rules version (and optionally updated calculation code). Changes are versioned in the session and can be inspected in the UI. This is the demo’s System 2-style policy-evolution path; it is separate from the permanent fast loop and requires `OPENAI_API_KEY`.

The concept brief also describes escalation on low confidence, novelty, or repeated failure, followed by validation and replay-testing before deployment. This demo exposes the decision output and supports human-reviewed post-death evolution, but does not automatically escalate based on confidence/novelty or persist/deploy evolved policies. Treat proposed code as a candidate to inspect and test.

## Controls and endpoints

- **Start game / Reset:** start or restart a run.
- **Ollaya control:** toggle between Ollaya decisions and keyboard steering.
- **Loop launch rate:** adjust the decision request rate from 0.25 to 20 Hz.
- **Keyboard:** arrow keys or `WASD`; `Space` pauses.
- `POST /api/ollaya-move`: forwards a bounded semantic-mode decision to Ollaya.
- `POST /api/evolve-rules`: streams optional rule-evolution output from OpenAI.

The browser talks only to this app’s server endpoints; API credentials are not sent to the page.
