import { c as init_esm, d as __require, f as __toCommonJS, l as __commonJSMin, s as esm_exports } from "./server.mjs";
import { t as require_execAsync } from "./execAsync-Bkzj8Qh0.mjs";

//#region D:/ai/projects/databricks-UI/jobs-console/node_modules/@opentelemetry/resources/build/src/detectors/platform/node/machine-id/getMachineId-win.js
var require_getMachineId_win = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getMachineId = void 0;
	const process = __require("process");
	const execAsync_1 = require_execAsync();
	const api_1 = (init_esm(), __toCommonJS(esm_exports));
	async function getMachineId() {
		const args = "QUERY HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid";
		let command = "%windir%\\System32\\REG.exe";
		if (process.arch === "ia32" && "PROCESSOR_ARCHITEW6432" in process.env) command = "%windir%\\sysnative\\cmd.exe /c " + command;
		try {
			const parts = (await (0, execAsync_1.execAsync)(`${command} ${args}`)).stdout.split("REG_SZ");
			if (parts.length === 2) return parts[1].trim();
		} catch (e) {
			api_1.diag.debug(`error reading machine id: ${e}`);
		}
	}
	exports.getMachineId = getMachineId;
}));

//#endregion
export default require_getMachineId_win();

export {  };