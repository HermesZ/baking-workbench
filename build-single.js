/* ============ 单文件打包脚本 ============
 * 把 index.html + style.css + app.js 打包成一个自包含的 HTML 文件,
 * 可直接传到手机用浏览器打开(无需服务器)。
 * 用法: node build-single.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "style.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// 安全检查:内嵌 JS 中不能出现 </script>(会提前结束脚本块)
if (js.includes("</script")) {
  console.error("错误: app.js 包含 </script,无法内嵌,请改名后重试");
  process.exit(1);
}

// 注意:replace 的替换字符串中 $$/$&/$`/$' 是特殊模式,
// 会破坏 JS 源码,因此必须用函数形式替换
const out = html
  .replace('<link rel="stylesheet" href="style.css">', () => "<style>\n" + css + "\n</style>")
  .replace('<script src="app.js"></script>', () => "<script>\n" + js + "\n</script>")
  // 文件较大时在标题后提示这是单文件版
  .replace("<title>烘焙工作台</title>", () => "<title>烘焙工作台(手机版)</title>");

const outFile = path.join(ROOT, "烘焙工作台-手机版.html");
fs.writeFileSync(outFile, out, "utf8");
console.log("已生成: " + outFile + " (" + fs.statSync(outFile).size + " bytes)");
console.log("把它传到手机,用手机浏览器打开即可(微信里打开后点右上角『在浏览器打开』更稳定)");
