import { c as init_esm, f as __toCommonJS, l as __commonJSMin, s as esm_exports } from "./server.mjs";

//#region D:/ai/projects/databricks-UI/jobs-console/node_modules/@opentelemetry/resources/build/src/detectors/platform/node/machine-id/getMachineId-unsupported.js
var require_getMachineId_unsupported = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.getMachineId = void 0;
	const api_1 = (init_esm(), __toCommonJS(esm_exports));
	async function getMachineId() {
		api_1.diag.debug("could not read machine-id: unsupported platform");
	}
	exports.getMachineId = getMachineId;
}));

//#endregion
export default require_getMachineId_unsupported();

export {  };