# 修订Joplin Pages Publisher插件
插件原项目地址 https://github.com/ylc395/joplin-plugin-pages-publisher
## 修订内容
1.通过引入markdown模块（https://github.com/millerblack/markdown-js），可使用通过引用markdown.toHTML(your md_content ).replace(/<[^>]+>/g,"").replace(/[\r\n\s]/g, "").replace(" ","").substr(0,LENGTH)在ejs页面提取文章摘要。
2.配合自定义模板实现joplin 笔记发布到github pages。
