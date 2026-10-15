import { SyntheticStore } from '../../../scripts/lib/read2lead-self-learn-sqlite.mjs';
let store, config;
process.on('message', message => {
  if (message.type === 'prepare') {
    config = message;
    try {
      store = new SyntheticStore({ root: config.root, fault: name => { if (name === config.crashAt) process.exit(86); } });
      process.send({ type: 'ready' });
    } catch (error) { process.send({ type: 'setup-error', code: error.code ?? error.message }, () => process.exit(1)); }
  } else if (message.type === 'run') {
    let result;
    try {
      const methods = ['submit', 'redeem', 'refund', 'fulfil'];
      if (!methods.includes(config.method)) throw Error('invalid_test_method');
      result = { type: 'result', ok: true, result: store[config.method](config.principal, config.data, config.now) };
    } catch (error) { result = { type: 'result', ok: false, code: error.code ?? error.message }; }
    finally { store.close(); }
    process.send(result, () => process.exit(0));
  }
});
