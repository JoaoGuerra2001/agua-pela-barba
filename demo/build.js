const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const cfg = read("config.json");
const shimSrc = fs.readFileSync(path.join(__dirname, "shim.js"), "utf8");
const shim = (mode) => shimSrc.replace("__CONFIG__", () => cfg).replace("__MODE__", mode);

// site do cliente
let site = read("public/index.html");
site = site.replace('<link rel="stylesheet" href="style.css">', () => "<style>\n" + read("public/style.css") + "\n</style>");
site = site.replace('<script src="app.js"></script>', () => "<script>\n" + shim("cliente") + "\n</script>\n<script>\n" + read("public/app.js") + "\n</script>");
fs.writeFileSync(path.join(root, "demo", "demo-site-cliente.html"), site);

// painel do administrador
let adm = read("admin/admin.html");
adm = adm.replace('<link rel="stylesheet" href="admin.css">', () => "<style>\n" + read("admin/admin.css") + "\n</style>");
adm = adm.replace('<script src="admin.js"></script>', () => "<script>\n" + shim("admin") + "\n</script>\n<script>\n" + read("admin/admin.js") + "\n</script>");
fs.writeFileSync(path.join(root, "demo", "demo-painel-admin.html"), adm);

console.log("site", site.length, "painel", adm.length);
