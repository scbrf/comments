const { unstable_dev } = require("wrangler");
const { ethers } = require("ethers");

describe("Worker", () => {
  let worker;

  beforeAll(async () => {
    worker = await unstable_dev(
      "src/index.js",
      {},
      { disableExperimentalWarning: true }
    );
  });

  afterAll(async () => {
    await worker.stop();
  });

  it("should return default format", async () => {
    const resp = await worker.fetch("/ppp/aaa");
    const data = await resp.json();
    expect(data.likes.length).toBe(0);
    expect(data.dislikes.length).toBe(0);
    expect(data.readers).toBe(0);
    expect(data.articleid).toBe("ppp/aaa");
    expect(Object.keys(data.comments).length).toBe(0);
  });

  it("test normal reader", async () => {
    const resp = await worker.fetch("/ppp/aaa", {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await resp.json();
    expect(data.readers).toBe(1);

    const rsp1 = await worker.fetch("/ppp/aaa");
    const data1 = await rsp1.json();
    expect(data1.readers).toBe(1);
  });

  it("test comment no sign", async () => {
    const resp = await worker.fetch("/ppp/aaa", {
      method: "POST",
      body: JSON.stringify({
        content: "good",
        uuid: "aaa-bbb-1",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await resp.json();
    expect(data.code).toBe(403);
  });

  it("test comment error sign", async () => {
    const resp = await worker.fetch("/ppp/aaa", {
      method: "POST",
      body: JSON.stringify({
        content: "good",
        uuid: "aaa-bbb-1",
        sign: "111",
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await resp.json();
    expect(data.code).toBe(403);
  });

  it("test real param", async () => {
    const rsp = await worker.fetch(
      "/yygqg.eth/a0cb8a1d-eccc-4704-b665-d32e5f357158",
      {
        method: "POST",
        body: JSON.stringify({
          content: "dff",
          from: "0x3c4e45c44141ef0480b419894cdb7e875c2d27ad",
          sign: "0x60db8f78506edfd8168c1e15313b91ba49152ea3f9fb6f5b867a247c63f739ad2938dd8d4a40b2ef27df8e003ff370f073a09771f6367bd292369d16e8efc4911b",
          uuid: "ee7c5dda-1822-4c13-b72d-b131529ecc63",
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    expect(rsp.status).toBe(200);
  });

  it("test comment and dup comment", async () => {
    const a1 = await worker.fetch("/ppp/aaa");
    const data = await a1.json();
    const readers = data.readers;
    const wallet = ethers.Wallet.createRandom();
    const content = "good";
    const uuid = "aaa-bbb-1";
    const digest = `${"_"}${wallet.address || "_"}${content}${uuid}${"_"}`;
    const sign = await wallet.signMessage(digest);
    const resp = await worker.fetch("/ppp/aaa", {
      method: "POST",
      body: JSON.stringify({
        content,
        uuid,
        from: wallet.address,
        sign,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
    const text = await resp.text();
    const json = JSON.parse(text);
    expect(json.readers).toBe(readers);
    expect(json.comments["aaa-bbb-1"].content).toBe("good");

    {
      const uuid2 = "uuid2";
      const digest2 = `${"like"}${
        wallet.address || "_"
      }_${uuid2}${"aaa-bbb-1"}`;
      const sign2 = await wallet.signMessage(digest2);
      const resReply = await worker.fetch("/ppp/aaa", {
        method: "POST",
        body: JSON.stringify({
          replyTo: "aaa-bbb-1",
          status: "like",
          uuid: uuid2,
          from: wallet.address,
          sign: sign2,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data2 = await resReply.json();
      expect(resReply.status).toBe(200);
      expect(data2.comments["aaa-bbb-1"].likes.length).toBe(1);
    }

    {
      const uuid2 = "uuid2";
      const digest2 = `${"-"}${wallet.address || "_"}_${uuid2}${"aaa-bbb-1"}`;
      const sign2 = await wallet.signMessage(digest2);
      const resReply = await worker.fetch("/ppp/aaa", {
        method: "POST",
        body: JSON.stringify({
          replyTo: "aaa-bbb-1",
          status: "-",
          uuid: uuid2,
          from: wallet.address,
          sign: sign2,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data2 = await resReply.json();
      expect(resReply.status).toBe(200);
      expect(data2.comments["aaa-bbb-1"].likes.length).toBe(0);
    }

    {
      const res = await worker.fetch("/ppp/aaa", {
        method: "POST",
        body: JSON.stringify({
          content: "good",
          uuid: "aaa-bbb-1",
          from: wallet.address,
          sign,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      expect(data.error).toBe("dup uuid");
    }

    {
      const digest = `_${wallet.address}_aaa-bbb-1_`;
      const sign = await wallet.signMessage(digest);
      const res = await worker.fetch("/ppp/aaa", {
        method: "POST",
        body: JSON.stringify({
          content: "",
          uuid: "aaa-bbb-1",
          from: wallet.address,
          sign,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Object.keys(data.comments).length).toBe(0);
    }
  });
});
