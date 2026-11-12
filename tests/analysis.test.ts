import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse } from "../web/src/analysis-ui";

test("Analysis routes out-of-order responses, cancels closed views, and recovers after worker errors", () => {
  const previous = globalThis.Worker;
  let worker: FakeWorker;
  class FakeWorker {
    onmessage!: (event: { data: object }) => void;
    onerror!: () => void;
    sent: any[] = [];
    constructor() {
      worker = this;
    }
    postMessage(data: any) {
      this.sent.push(data);
    }
    terminate() {}
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    const received: string[] = [];
    analyse("reverse", "figma", {}, (result) => received.push(result));
    analyse("name", "goftoo", {}, (result) => received.push(result));
    const [reverse, name] = worker!.sent;
    worker!.onmessage({ data: { id: name.id, result: "name" } });
    worker!.onmessage({ data: { id: reverse.id, result: "reverse" } });
    assert.deepEqual(received, ["name", "reverse"]);
    const cancel = analyse("name", "closed", {}, () =>
      assert.fail("closed view received a response"),
    );
    cancel();
    worker!.onmessage({ data: { id: worker!.sent.at(-1).id, result: "late" } });
    let errors = 0;
    analyse("name", "goftoo", {}, (_, error) => {
      assert.ok(error);
      errors++;
    });
    analyse("reverse", "figma", {}, (_, error) => {
      assert.ok(error);
      errors++;
    });
    worker!.onerror();
    assert.equal(errors, 2);
    const failed = worker!;
    analyse("name", "goftoo", {}, (result) => received.push(result));
    assert.notEqual(worker!, failed);
    worker!.onmessage({
      data: { id: worker!.sent[0].id, result: "recovered" },
    });
    assert.equal(received.at(-1), "recovered");
  } finally {
    globalThis.Worker = previous;
  }
});
