export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export async function connect(port, predicate, child) {
  let target;
  for (let n = 0; n < 300; n++) {
    if (child.exitCode !== null) throw Error('Aplicativo encerrou antes do CDP');
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(predicate);
      if (target) break;
    } catch {
      /* starting */
    }
    await pause(100);
  }
  if (!target) throw Error('CDP indisponível ' + port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    socket.onopen = r;
    socket.onerror = j;
  });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = (e) => {
    const m = JSON.parse(e.data),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result);
    }
  };
  socket.onclose = () => {
    for (const p of pending.values()) p.reject(Error('CDP encerrado'));
    pending.clear();
  };
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error('CDP timeout ' + method));
        }, 65000);
      pending.set(id, {
        resolve: (x) => {
          clearTimeout(timer);
          resolve(x);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  return { call, evaluate, close: () => socket.close() };
}
