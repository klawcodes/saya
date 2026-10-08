$ErrorActionPreference = "Stop"

$name  = "Saya"
$out   = "dist"
$app   = "$out\$name-win32-x64"
$iscc  = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
$keep  = @("en-US.pak", "id.pak")   # bahasa yang dipertahankan

# 1. Bersihkan build lama
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue

# 2. Package aplikasi
$ignore = '(^/dist($|/))|(^/installer($|/))|(^/\.git($|/))|(^/\.github($|/))|(\.map$)|(^/README\.md$)|(^/build\.ps1$)'

npx electron-packager . $name `
  --platform=win32 --arch=x64 `
  --out=$out --overwrite `
  --asar --prune=true `
  "--ignore=$ignore" `
  --icon=icon.ico `
  --win32metadata.ProductName=Saya `
  --win32metadata.FileDescription=Saya `
  --win32metadata.InternalName=Saya `
  --win32metadata.OriginalFilename=Saya.exe `
  '--win32metadata.CompanyName="RIOT REVENGER"' `
  '--app-copyright="Copyright (c) RIOT REVENGER"'

if ($LASTEXITCODE -ne 0) { throw "electron-packager gagal" }

# 3. Buang bahasa yang tidak dipakai
Get-ChildItem "$app\locales\*.pak" |
  Where-Object { $_.Name -notin $keep } |
  Remove-Item

# 4. Compile installer Inno
& $iscc "installer\saya.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup gagal" }

# 5. Hash SHA-256 untuk release notes
Get-ChildItem "installer\output\Saya-Setup-*.exe" |
  ForEach-Object {
    "{0}  {1:N1} MB" -f $_.Name, ($_.Length / 1MB)
    (Get-FileHash $_.FullName -Algorithm SHA256).Hash
  }