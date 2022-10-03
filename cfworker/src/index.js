import { ethers } from "ethers";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const defaultValue = {
  likes: [],
  dislikes: [],
  readers: 0,
  comments: {},
};

class Execute {
  async fetchFromKVStore(env, articleid, key) {
    let value = await env.comments.get(key);
    return new Response(
      JSON.stringify({
        ...defaultValue,
        articleid,
        ...JSON.parse(value || "{}"),
      }),
      {
        headers: {
          ...corsHeaders,
          "content-type": "application/json;charset=UTF-8",
        },
      }
    );
  }

  async fetchFromGateway(env, request, body) {
    const id = env.Gateway.idFromName("commentsStore");
    const gateway = env.Gateway.get(id);
    const timestamp = new Date().getTime();
    const grsp = await gateway.fetch(request.url, {
      method: "POST",
      body: JSON.stringify({
        ...body,
        timestamp,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      cf: { apps: false },
    });
    if (grsp.status == 200) {
      return await grsp.json();
    } else {
      const errmsg = await grsp.text();
      throw new Error(`${errmsg}`);
    }
  }

  validateParam(body) {
    const { status, from, content, uuid, replyTo, sign } = body;
    if ((status || from || content || uuid || replyTo) && !sign) {
      //匿名用户不允许传递任何参数，就是一个已读+1
      throw new Error("not allow");
    }
    if (sign) {
      const digest = ethers.utils.hashMessage(
        `${status || "_"}${from || "_"}${content || "_"}${uuid || "_"}${
          replyTo || "_"
        }`
      );
      const address = ethers.utils.recoverAddress(digest, sign);
      if (address.toLocaleLowerCase() !== from.toLocaleLowerCase()) {
        console.log(`expect ${from} got ${address}`);
        throw new Error("sign mismatch");
      }
    }
  }

  handleOptions(request) {
    let headers = request.headers;
    if (
      headers.get("Origin") !== null &&
      headers.get("Access-Control-Request-Method") !== null &&
      headers.get("Access-Control-Request-Headers") !== null
    ) {
      let respHeaders = {
        ...corsHeaders,
        "Access-Control-Allow-Headers": request.headers.get(
          "Access-Control-Request-Headers"
        ),
      };
      return new Response(null, {
        headers: respHeaders,
      });
    } else {
      return new Response(null, {
        headers: {
          Allow: "GET, HEAD, POST, OPTIONS",
        },
      });
    }
  }

  async realFetch(request, env) {
    const { pathname } = new URL(request.url);
    const [_, ipns, uuid] = pathname.split("/");
    if (!ipns || !uuid) return error(403, "Bad");
    const articleid = `${ipns}/${uuid}`;
    const key = `_cs/${articleid}`;
    if (request.method === "GET") {
      return this.fetchFromKVStore(env, articleid, key);
    } else if (request.method === "OPTIONS") {
      return this.handleOptions(request);
    } else if (request.method === "POST") {
      try {
        const body = await request.json();
        console.log("request params", articleid, body);
        this.validateParam(body);
        const comments = await this.fetchFromGateway(env, request, {
          ...body,
          articleid,
        });
        await env.comments.put(key, JSON.stringify(comments));
        return json(comments);
      } catch (ex) {
        return error(403, ex.message);
      }
    }
  }

  async fetch(request, env) {
    try {
      return await this.realFetch(request, env);
    } catch (ex) {
      console.log("error in fetch", ex.message, ex.stack);
      return error(500, "internal error");
    }
  }
}

export class Comments {
  constructor(state) {
    this.state = state;
  }

  deleteJukeComments(comments) {
    let findNeedDeleted = true;
    while (findNeedDeleted) {
      findNeedDeleted = false;
      for (let key of Object.keys(comments.comments || {})) {
        const post = comments.comments[key];
        if (post.replyTo && !comments.comments[post.replyTo]) {
          delete comments.comments[key];
          findNeedDeleted = true;
          break;
        }
      }
    }
  }

  async processFetch(request) {
    //如果有异常，就抛出去你觉得怎么样？
    const comment = await request.json();

    //sign： 验签这个动作在worker里做吧，减轻一下DurableObject的工作量
    const {
      articleid,
      status,
      from,
      content,
      uuid,
      timestamp,
      replyTo,
      trusted,
    } = comment;
    const commentsKey = `_cs/${articleid}`;
    const storedValue = await this.state.storage.get(commentsKey);
    const comments = {
      ...defaultValue,
      ...(storedValue || {}),
    };
    if (!status && !uuid) {
      comments.readers = (comments.readers || 0) + 1; //增加一次阅读
    }

    if (replyTo && !(replyTo in comments.comments[replyTo])) {
      error(403, "no parent post");
    }

    //一个用户不可以既喜欢又不喜欢，所以
    if (status === "like") {
      if (!replyTo) {
        //用户喜欢主贴
        comments.dislikes = (comments.dislikes || []).filter((u) => u !== from);
        comments.likes = [
          from,
          ...(comments.likes || []).filter((u) => u !== from),
        ];
      } else {
        //用户喜欢某条评论
        comments.comments[replyTo].dislikes = (
          comments.comments[replyTo].dislikes || []
        ).filter((u) => u !== from);
        comments.comments[replyTo].likes = [
          from,
          ...(comments.comments[replyTo].likes || []).filter((u) => u !== from),
        ];
      }
    } else if (status === "dislike") {
      if (!replyTo) {
        //用户不喜欢主贴
        comments.likes = (comments.likes || []).filter((u) => u !== from);
        comments.dislikes = [
          from,
          ...(comments.dislikes || []).filter((u) => u !== from),
        ];
      } else {
        //用户不喜欢某条评论
        comments.comments[replyTo].likes = (
          comments.comments[replyTo].likes || []
        ).filter((u) => u !== from);
        comments.comments[replyTo].dislikes = [
          from,
          ...(comments.comments[replyTo].dislikes || []).filter(
            (u) => u !== from
          ),
        ];
      }
    } else if (status) {
      //对于其它的status不为空的情况，一律认为是用户想取消状态
      if (!replyTo) {
        //用户不喜欢主贴
        comments.likes = (comments.likes || []).filter((u) => u !== from);
        comments.dislikes = (comments.dislikes || []).filter((u) => u !== from);
      } else {
        //用户不喜欢某条评论
        comments.comments[replyTo].likes = (
          comments.comments[replyTo].likes || []
        ).filter((u) => u !== from);
        comments.comments[replyTo].dislikes = (
          comments.comments[replyTo].dislikes || []
        ).filter((u) => u !== from);
      }
    }
    comments.readers = comments.readers || 0;
    comments.likes = comments.likes || [];
    comments.dislikes = comments.dislikes || [];

    if (uuid) {
      if (!comments.comments) {
        comments.comments = {};
      }
      if (content && uuid in comments.comments) {
        return error(403, "dup uuid");
      }
      if (content) {
        comments.comments[uuid] = {
          uuid,
          from,
          timestamp,
          content,
          replyTo,
          trusted,
        };
      } else if (content === "") {
        //如果内容为空，代表用户想删除这条评论
        //所有针对这条评论的回复将会成为孤岛，应该被删除
        // 这个功能以后再做吧
        delete comments.comments[uuid];
      }
    }
    this.deleteJukeComments(comments);
    await this.state.storage.put(commentsKey, comments);

    return json(comments);
  }

  //只有新增一个评论记录的时候才会调用这个函数，body就是评论
  async fetch(request) {
    try {
      return await this.processFetch(request);
    } catch (ex) {
      console.log("durable object error", ex.toString(), ex.stack);
      return error(403, ex.message);
    }
  }
}

function json(obj) {
  return new Response(JSON.stringify(obj), {
    headers: {
      ...corsHeaders,
      "content-type": "application/json;charset=UTF-8",
    },
  });
}

function error(code, msg) {
  return new Response(
    JSON.stringify({
      code,
      error: msg,
    }),
    {
      headers: {
        ...corsHeaders,
        "content-type": "application/json;charset=UTF-8",
      },
    }
  );
}

export default new Execute();
