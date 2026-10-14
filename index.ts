import { ExtensionAPI } from "@pi-host/pi-extensions";
import { registerFileTools } from "./indexFileTools";
import { registerCodingTools } from "./indexCodingTools";
import { createPermissionGate } from "./sandbox/permissionGate";
import { setSandboxState } from "./sandbox/sandbox";

export default {
  async session_start(pi: ExtensionAPI) {
    // Register all tools
    registerFileTools(pi);
    registerCodingTools(pi);

    // Set up sandbox toggle
    pi.registerCommand({
      id: "/toggle-sandbox",
      description: "Toggle the sandbox on/off",
      handler: async (args: { state?: "on" | "off" }) => {
        const newState = args.state || (pi.getSandboxState() === "on" ? "off" : "on");
        setSandboxState(newState);
        return `Sandbox is now ${newState}.`;
      },
    });

    // Disable Pi's built-in bash tool
    pi.on("tool_call", createPermissionGate(pi.getRegisteredTools()));

    // Reset sandbox state to "on" at the start of each session
    setSandboxState("on");
  },
};