import { spawn } from "child_process"

const mcp = spawn("uvx", [
  "git+https://github.com/googlecolab/colab-mcp",
], {
  stdio: ["ignore", "pipe", "pipe"],
})

mcp.stdout.on("data", (data) => {
  console.log("MCP:", data.toString())
})

mcp.stderr.on("data", (data) => {
  console.error("MCP ERR:", data.toString())
})

mcp.on("error", (error) => {
  console.error("MCP SPAWN ERR:", error)
})

mcp.on("close", (code, signal) => {
  console.log("MCP EXIT:", { code, signal })
})

process.on("SIGINT", () => {
  mcp.kill("SIGINT")
})
