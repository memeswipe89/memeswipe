import uuidImport from './dist/index.js';

const uuidObject =
  (uuidImport && typeof uuidImport === 'object' && 'default' in uuidImport ? uuidImport.default : uuidImport) ||
  uuidImport ||
  {};

export const v1 = uuidObject.v1;
export const v3 = uuidObject.v3;
export const v4 = uuidObject.v4;
export const v5 = uuidObject.v5;
export const NIL = uuidObject.NIL;
export const version = uuidObject.version;
export const validate = uuidObject.validate;
export const stringify = uuidObject.stringify;
export const parse = uuidObject.parse;

export default uuidObject;
