import * as uuidNamespace from "@privy-io/js-sdk-core/node_modules/uuid/dist/index.js";

const uuidModule =
  (uuidNamespace && typeof uuidNamespace === "object" && "default" in uuidNamespace
    ? uuidNamespace.default
    : uuidNamespace) ?? uuidNamespace ?? {};

const uuid = uuidModule || {};

export const v1 = uuid.v1;
export const v3 = uuid.v3;
export const v4 = uuid.v4;
export const v5 = uuid.v5;
export const NIL = uuid.NIL;
export const version = uuid.version;
export const validate = uuid.validate;
export const stringify = uuid.stringify;
export const parse = uuid.parse;

export default uuid;
