import { Handler } from "./handler"; // fu:Handler=import
import OtherHandler from "./other-handler"; // fu:Handler=null

export class Handler { // fu:Handler=definition
  constructor() {}
}

class MyHandler extends Handler { // fu:Handler=type-reference
}

class OtherImpl implements Handler { // fu:Handler=type-reference
}

function process(h: Handler): void {} // fu:Handler=type-reference

const list: Array<Handler> = []; // fu:Handler=type-reference

function makeHandler() {
  const h = new Handler(); // fu:Handler=instantiation
  Handler.create(); // fu:Handler=static-access
  registry.Handler(); // fu:Handler=static-access
  Handler(h); // fu:Handler=call
  const fn = Handler; // fu:Handler=reference
  return h;
}

class HandlerFactory {} // fu:Handler=null
const hf = new HandlerFactory(); // fu:Handler=null
