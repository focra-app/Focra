import * as ortWeb from "onnxruntime-web";
const ort = (ortWeb as { default?: typeof ortWeb }).default ?? ortWeb;
export default ort;
