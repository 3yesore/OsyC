# OsyC 品牌资产规范（唯一来源）

> 目的：logo 只允许存在一份主文件，所有界面/文档/邮件统一引用它，禁止各自另存副本。

## 1. 主文件（master）

| 位置 | 文件 | 说明 |
| --- | --- | --- |
| 仓库根目录 | `OsyC-logo.png` | 1254×1254，透明/白底方形锁定版：圆形渐变标记 + `OsyC` 字标 + tagline |

- 后端仓库同步放在根目录：`OsyC-logo.png`。
- **只允许在这一处维护**；不要按使用场景再存一份，也不要改色、改比例、加描边。

## 2. 派生尺寸（自动生成，勿手改）

| 路径 | 尺寸 | 用途 |
| --- | --- | --- |
| `assets/brand/OsyC-logo-96.png` | 96×96 | 小图标、favicon 备选 |
| `assets/brand/OsyC-logo-192.png` | 192×192 | **邮件内嵌（CID）**、列表图标 |
| `assets/brand/OsyC-logo-256.png` | 256×256 | 应用内头像/头像位（2× 屏） |
| `assets/brand/OsyC-logo-512.png` | 512×512 | 安装包、商店图、社交预览 |

后端把邮件用到的尺寸放在 `app/assets/`（随 release 一起发布）：
`app/assets/OsyC-logo-192.png`。

重新生成派生图（Windows, System.Drawing）：

```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile("OsyC-logo.png")
foreach ($size in 96,192,256,512) {
  $bmp = New-Object System.Drawing.Bitmap $size,$size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $size, $size); $g.Dispose()
  $bmp.Save("assets/brand/OsyC-logo-$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$img.Dispose()
```

## 3. 文案署名

- 署名、页脚、邮件落款一律只写 **OsyC**，不要写"笔记助手""智能笔记助手"等后缀。
- 邮件页脚格式：`OsyC · YYYY-MM-DD HH:MM`。
- 产品名大小写固定为 `OsyC`（不要 `Osyc` / `osyc`；代码标识符除外）。

## 4. 邮件中的用法

- `app/mailer.py` 以 `multipart/related` + CID `osyc-logo` 内嵌 192px PNG，显示宽度 128px。
- 默认路径常量 `DEFAULT_LOGO_PATH = app/assets/OsyC-logo-192.png`；可用环境变量 `OSYC_MAIL_LOGO` 覆盖。
- 文件缺失时自动退回文字标识（`O` 方块 + OsyC），发送不会失败。
- **禁止**在邮件里引用外链图片（会被邮箱客户端拦截、并降低送达率）。
