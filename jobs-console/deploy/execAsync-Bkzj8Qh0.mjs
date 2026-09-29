import { d as __require, l as __commonJSMin } from "./server.mjs";

//#region D:/ai/projects/databricks-UI/jobs-console/node_modules/@opentelemetry/resources/build/src/detectors/platform/node/machine-id/execAsync.js
var require_execAsync = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.execAsync = void 0;
	const child_process = __require("child_process");
	const util = __require("util");
	exports.execAsync = util.promisify(child_process.exec);
}));

//#endregion
export { require_execAsync as t };