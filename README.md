# Scarborough使用的评论系统

## fe
前端代码，需要配合Scarborough的Plain模板使用，通过 yarn build 命令生成 commets.js，然后将整个assets目录里的blog.html文件覆盖Plain模板templates目录中的同名文件，其它文件覆盖assets目录里的对应文件即可

## cfworker

通过 wrangler 部署即可，注意替换前端代码中的入口域名