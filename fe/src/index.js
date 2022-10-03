const axios = require("axios");
const uuid = require("uuid").v4;
const moment = require("moment");
require("moment/locale/zh-cn");
/**
 *
 * 存在 planetid 和 articleid，就会去获取所有评论
 *
 * 调用函数 scbrfCommentsConfig({planetid, articleid, beforeMount:()=>{} })
 *
 * 检查是否存在 scbrf-comments-container，将所有拥有这个class的element的 display 设置为 flex
 * 检查是否存在 scbrf-comments-readers 将其innerText 设置为 阅读数
 * 检查是否存在 scbrf-comments-likes 将其innerText 设置为 点赞数
 * 检查是否存在 scbrf-comments-dislikes 将其innerText 设置为 点不喜欢数量
 * 检查是否存在 scbrf-comments 将其内容替换为整理以后的comments
 *
 * 如果存在 window.ethereum，显示 发布评论 输入框
 *
 */

// From: https://stackoverflow.com/questions/8523200/javascript-get-current-filescript-path
var retrieveURL = function (filename) {
  var scripts = document.getElementsByTagName("script");
  if (scripts && scripts.length > 0) {
    for (var i in scripts) {
      console.log(scripts[i].src);
      const pos = scripts[i].src.indexOf("comments.js");
      if (pos > 0) {
        return scripts[i].src.substring(0, pos);
      }
    }
  }
};

class ScbrfComments {
  constructor(cfg) {
    this.config = cfg;
    this.scriptPath = retrieveURL("comments.js");
    console.log(this.scriptPath);
  }

  initAccount() {
    if (window.ethereum) {
      ethereum.on("accountsChanged", (accounts) => {
        this.account = accounts[0];
      });
      if (window.ethereum.isMetaMask) {
        this.trusted = "metamask";
      } else if (window.ethereum.isScarborough) {
        this.trusted = "scarborough";
      } else {
        this.trusted = "";
      }
      if (this.trusted) {
        console.log("Trusted by", this.trusted);
      }
    }
  }

  async markReaded() {
    if (this.config.notMarkRead) return;
    if (this.markReadDone) return;
    this.markReadDone = true;
    console.log("request to increase read times ... ");
    try {
      await this.reply();
      console.log("increase read times done");
    } catch (ex) {
      this.markReadDone = false;
    }
  }

  hideContainers() {
    let containers = document.querySelectorAll(".scbrf-comments-container");
    [...containers].forEach((c) => {
      this.rootContainers.push([c, c.style.display]);
    });
    containers = document.querySelectorAll(".scbrf-comments-input-container");
    [...containers].forEach((c) => {
      this.rootContainers.push([c, c.style.display]);
    });
    for (let c of this.rootContainers) {
      c[0].style.display = "none";
    }
  }
  showContainers() {
    for (let c of this.rootContainers) {
      c[0].style.display = c[1] || "block";
    }
  }

  showHelper() {
    if (this.config.showHelper) {
      if (!window.ethereum) {
        document.querySelector(
          ".scbrf-comments-helper"
        ).innerHTML = `* 您的浏览器不支持发布状态或者评论`;
      }
    }
  }

  initUI() {
    this.rootContainers = [];
    this.hideContainers();
    this.showHelper();
  }

  async initData() {
    const base = this.config.entry || "https://comments.scbrf.workers.dev";
    this.URL = `${base}/${this.config.planetid}/${this.config.articleid}`;
    if (this.config.planetid && this.config.articleid) {
      const comments = await axios.get(
        this.URL + "?seed=" + new Date().getTime()
      );
      if (comments) {
        this.updateUI(comments.data);
      }
    }
  }

  async init() {
    console.log("scbrf config", this.config);
    this.initAccount();
    this.initUI();
    this.initData();
    setTimeout(() => {
      //如果停留时间超过30秒，也算是一次阅读吧
      this.markReaded();
    }, 30000);
  }

  async requestAccount() {
    if (!window.ethereum) return;
    const accounts = await ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length == 0) return;
    this.account = accounts[0];
  }

  async requestSign(replyTo, id, content, status) {
    if (!this.account) {
      console.log("error, request sign but no account");
      return;
    }
    const msg = `${status || "_"}${this.account || "_"}${content || "_"}${
      id || "_"
    }${replyTo || "_"}`;
    return await ethereum.request({
      method: "personal_sign",
      params: [msg, this.account],
    });
  }

  //reply 有几种情况，可以是回复文字评论也可以是点赞，可以是回复主文也可以是回复评论
  //从e.target的data-reply-to 获取reply主文还是评论
  //从e.target的class是 like dislike 来判断是否回复status，如果都没有就是content
  //content 从parentNode.querySelector('input')获取
  async reply(e) {
    if (e && !window.ethereum) return;
    const replyTo = e && e.currentTarget.getAttribute("data-reply-to");
    let id = e && e.currentTarget.getAttribute("data-uuid");
    if (e && !id) {
      id = uuid();
    }
    const input = e && e.currentTarget.parentNode.querySelector("input");
    let content = null;
    if (input) {
      content = input.value;
      input.disabled = true;
      input.value = "";
    }
    let status = null;
    if (e && e.currentTarget.classList.contains("like")) {
      status = "like";
    } else if (e && e.currentTarget.classList.contains("dislike")) {
      status = "dislike";
    } else if (e && e.currentTarget.classList.contains("deletebtn")) {
      content = "";
    }
    if (e) {
      await this.requestAccount();
    }
    //已读消息不需要验签
    const sign = e && (await this.requestSign(replyTo, id, content, status));
    if ((id || content || status) && !sign) return;
    const rsp = await axios.post(this.URL, {
      from: e && this.account,
      content,
      status,
      replyTo,
      sign,
      uuid: id,
      trusted: this.trusted,
    });
    if (input) {
      input.disabled = false;
    }
    if (!rsp.data.code) {
      this.updateUI(rsp.data);
    } else {
      return rsp.data.error;
    }
  }

  trustedBy(trusted) {
    return {
      metamask: {
        title: `Trusted by MetaMask`,
        href: `https://metamask.io/`,
      },
      scarborough: {
        title: `Trusted by Scarborough`,
        href: `https://github.com/scbrf/scbrf`,
      },
    }[trusted];
  }

  commentPostUI(all, post) {
    const childrenDOM = all.filter((p) => p.replyTo === post.uuid);
    childrenDOM.sort((a, b) => b.timestamp - a.timestamp);
    const children = childrenDOM
      .map((p) => this.commentPostUI(all, p))
      .join("\n");

    let deletebtn = "";
    if (post.from === this.account) {
      deletebtn = `<div class="deletebtn" data-uuid="${post.uuid}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6">
        <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>      
          </div>`;
    }
    let trusted = "";
    if (post.trusted) {
      trusted = `<div class="trusted"><a target="_blank" href="${
        this.trustedBy(post.trusted).href
      }"><img title="${this.trustedBy(post.trusted).title}" src="${
        this.scriptPath + post.trusted
      }.png"></a></div>`;
    }

    return `
<div class="scbrf-comments-post">
    <div class="meta">
        <div class="from">${
          post.from === this.account ? "You" : post.from
        }</div> 于
        <div class="date">${post.date}</div>
        ${trusted}
    </div>
    <div class="commentbody">${post.content}</div>
    <div class="oprations">
    <input data-reply-to="${post.uuid}" />
    ${deletebtn}
        <div data-reply-to="${post.uuid}" class="likes like">likes:${
      (post.likes || []).length
    }</div>
        <div data-reply-to="${post.uuid}" class="dislikes dislike">dislikes:${
      (post.dislikes || []).length
    }</div>
    </div>
    ${children}
</div>    
`;
  }

  updateUI(data) {
    console.log(data);
    const allcomments = Object.keys(data.comments).map((id) => ({
      ...data.comments[id],
      date: moment(data.comments[id].timestamp).fromNow(),
    }));
    const rootComments = allcomments.filter((c) => !c.replyTo);
    rootComments.sort((a, b) => b.timestamp - a.timestamp);
    this.showContainers();
    let readers = document.querySelectorAll(".scbrf-comments-readers");
    [...readers].forEach((c) => (c.innerHTML = data.readers));
    let likers = document.querySelectorAll(".scbrf-comments-likes");
    [...likers].forEach((c) => (c.innerHTML = data.likes.length));
    let dislikers = document.querySelectorAll(".scbrf-comments-dislikes");
    [...dislikers].forEach((c) => (c.innerHTML = data.dislikes.length));
    let comments = document.querySelectorAll(".scbrf-comments-posts");
    [...comments].forEach(
      (c) => (c.innerHTML = Object.keys(data.comments).length)
    );

    const commentsRoot = document.querySelector("#comments");
    if (commentsRoot) {
      commentsRoot.innerHTML = rootComments
        .map((post) => this.commentPostUI(allcomments, post))
        .join("\n");
    }

    [...document.querySelectorAll(".scbrf-comments-container .like")].forEach(
      (node) => (node.onclick = this.reply.bind(this))
    );
    [
      ...document.querySelectorAll(".scbrf-comments-container .dislike"),
    ].forEach((node) => (node.onclick = this.reply.bind(this)));

    [
      ...document.querySelectorAll(".scbrf-comments-container .deletebtn"),
    ].forEach((node) => (node.onclick = this.reply.bind(this)));

    //拥有eth的能力，打开评论对话框
    let inputs = document.querySelectorAll(".scbrf-comments-container input");
    if (window.ethereum) {
      [...inputs].forEach(
        (c) =>
          (c.onkeydown = (e) => {
            if (e.keyCode == 13) {
              this.reply(e);
            }
          })
      );
    } else {
      [...inputs].forEach((i) => (i.style.display = "none"));
    }
  }
}

window.scbrfCommentsConfig = (cfg) => {
  window.__ScbrfComments = new ScbrfComments(cfg);
};

window.addEventListener("DOMContentLoaded", async () => {
  if (window.__ScbrfComments) {
    window.__ScbrfComments.init();
  }
});

window.addEventListener("scroll", () => {
  if (
    window.innerHeight + window.pageYOffset >=
    document.querySelector(".main .content").offsetHeight - 2
  ) {
    if (window.__ScbrfComments) {
      window.__ScbrfComments.markReaded();
    }
  }
});
