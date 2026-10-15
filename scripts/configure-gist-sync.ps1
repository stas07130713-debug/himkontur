param(
  [string]$AdminPassword = '1234'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot 'public\data\district-map.json'
$configPath = Join-Path $projectRoot 'public\data\gist-sync.json'
if (-not (Test-Path -LiteralPath $dataPath)) { throw 'Не найден файл базы district-map.json.' }

$secureToken = Read-Host 'Вставьте GitHub token с единственным правом gist' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($token)) { throw 'GitHub token не введён.' }

  $headers = @{
    Accept = 'application/vnd.github+json'
    Authorization = "Bearer $token"
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'HIMKONTUR-Gist-Setup'
  }
  $dataText = [IO.File]::ReadAllText($dataPath, [Text.Encoding]::UTF8)
  $gistRequest = @{
    description = 'ХИМКОНТУР — актуальная база карты района выезда'
    public = $true
    files = @{ 'district-map.json' = @{ content = $dataText } }
  } | ConvertTo-Json -Depth 8
  $gist = Invoke-RestMethod -Uri 'https://api.github.com/gists' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($gistRequest))

  $salt = [byte[]]::new(16)
  $iv = [byte[]]::new(12)
  [Security.Cryptography.RandomNumberGenerator]::Fill($salt)
  [Security.Cryptography.RandomNumberGenerator]::Fill($iv)
  $passwordBytes = [Text.Encoding]::UTF8.GetBytes($AdminPassword)
  $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new($passwordBytes, $salt, 210000, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try { $key = $deriver.GetBytes(32) } finally { $deriver.Dispose() }
  $plain = [Text.Encoding]::UTF8.GetBytes($token)
  $ciphertext = [byte[]]::new($plain.Length)
  $tag = [byte[]]::new(16)
  $aes = [Security.Cryptography.AesGcm]::new($key, 16)
  try { $aes.Encrypt($iv, $plain, $ciphertext, $tag) } finally { $aes.Dispose() }
  $combined = [byte[]]::new($ciphertext.Length + $tag.Length)
  [Array]::Copy($ciphertext, 0, $combined, 0, $ciphertext.Length)
  [Array]::Copy($tag, 0, $combined, $ciphertext.Length, $tag.Length)

  $config = [ordered]@{
    gistId = [string]$gist.id
    owner = [string]$gist.owner.login
    fileName = 'district-map.json'
    encryptedToken = [ordered]@{
      salt = [Convert]::ToBase64String($salt)
      iv = [Convert]::ToBase64String($iv)
      ciphertext = [Convert]::ToBase64String($combined)
      iterations = 210000
    }
  } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($configPath, "$config`n", [Text.UTF8Encoding]::new($false))
  Write-Host "Готово. Создана отдельная база GitHub Gist: $($gist.html_url)" -ForegroundColor Green
  Write-Host 'Token сохранён только в зашифрованном виде.' -ForegroundColor Green
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  $token = $null
}
