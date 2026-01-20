# Eklavya Autonomous Agents

These scripts run independently in separate terminals - no permission prompts.

## Usage

```bash
# Make scripts executable (one time)
chmod +x /Users/ganeshpandey/eklavya/scripts/**/*.sh

# Run any agent
./scripts/run-demo-tester.sh
./scripts/run-dev-server.sh
./scripts/run-overnight.sh
```

## Agent Scripts

| Script | Purpose |
|--------|---------|
| `run-dev-server.sh` | Start the web dev server |
| `run-demo-tester.sh` | Verify demo is working |
| `run-overnight.sh` | Run full autonomous build overnight |
| `agents/tester.sh` | QA tester agent |
| `agents/builder.sh` | Build agent |

## How It Works

1. Claude Code creates/updates these scripts
2. Scripts run in separate terminal processes
3. No permission prompts - fully autonomous
4. Output goes to logs in `logs/` directory
5. Scripts can spawn other scripts (agent orchestration)

## Running in Background

```bash
# Run with nohup (survives terminal close)
nohup ./scripts/run-overnight.sh > logs/overnight.log 2>&1 &

# Or use screen/tmux for interactive monitoring
screen -S eklavya-agents ./scripts/run-overnight.sh
```
