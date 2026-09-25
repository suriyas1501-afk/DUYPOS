# =====================================================================
#  check-setup.ps1 - collect everything needed to set up silent printing
#
#  Run on the SHOP computer (no admin needed, read-only):
#      powershell -ExecutionPolicy Bypass -File .\check-setup.ps1
#
#  Nothing is changed. Copy the whole output back into the chat.
#  ASCII only on purpose - Thai text breaks in some PowerShell consoles.
# =====================================================================

Write-Output ''
Write-Output '=== 1. PRINTERS ====================================================='
Write-Output '(Name is what you must type into open-drawer.ps1 -PrinterName)'
Get-Printer | Select-Object Name, DriverName, PortName, Shared |
    Format-Table -AutoSize | Out-String -Width 200

Write-Output '=== 2. PRINTER DRIVER VERSION ======================================='
Write-Output '(MajorVersion 4 needs XPS_PASS instead of RAW - open-drawer.ps1 handles it)'
try {
    Get-PrinterDriver | Select-Object Name, MajorVersion, PrinterEnvironment |
        Format-Table -AutoSize | Out-String -Width 200
} catch {
    Write-Output ('  could not read drivers: ' + $_.Exception.Message)
}

Write-Output '=== 3. DEFAULT PRINTER =============================================='
try {
    # WQL has no $true - filter in PowerShell instead of in the query
    $def = Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop |
           Where-Object { $_.Default } | Select-Object -First 1
    if ($def) { Write-Output ('  Default printer : ' + $def.Name) }
    else { Write-Output '  Default printer : (none set)' }
} catch {
    Write-Output ('  could not read default printer: ' + $_.Exception.Message)
}

# LegacyDefaultPrinterMode = 1  ->  Windows does NOT auto-switch the default.
# Missing or 0                 ->  "Let Windows manage my default printer" is ON.
$legacyKey = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows'
$legacy = $null
try { $legacy = (Get-ItemProperty -Path $legacyKey -Name LegacyDefaultPrinterMode -ErrorAction Stop).LegacyDefaultPrinterMode } catch {}
if ($legacy -eq 1) {
    Write-Output '  Let Windows manage my default printer : OFF  <-- correct for POS'
} else {
    Write-Output '  Let Windows manage my default printer : ON   <-- TURN THIS OFF'
    Write-Output '    Settings > Bluetooth & devices > Printers & scanners'
}

Write-Output ''
Write-Output '=== 4. CHROME ======================================================='
$chromePaths = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) {
    $ver = (Get-Item $chrome).VersionInfo.ProductVersion
    Write-Output ('  Version : ' + $ver + '   (' + $chrome + ')')
    $major = 0
    [void][int]::TryParse(($ver -split '\.')[0], [ref]$major)
    if ($major -ge 144) {
        Write-Output '  SilentPrintingEnabled policy : SUPPORTED (needs 144+)'
    } else {
        Write-Output '  SilentPrintingEnabled policy : NOT SUPPORTED - use the --kiosk-printing shortcut instead'
    }
} else {
    Write-Output '  Chrome not found in the usual locations.'
}

Write-Output ''
Write-Output '=== 5. POLICY ALREADY APPLIED? ======================================'
$polKey = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
if (Test-Path $polKey) {
    Get-ItemProperty -Path $polKey |
        Select-Object SilentPrintingEnabled, PrintPreviewUseSystemDefaultPrinter, PrintHeaderFooter |
        Format-List | Out-String -Width 200
    Write-Output '  (blank = not set yet. Run silent-print-on.reg as Administrator.)'
} else {
    Write-Output '  Not set yet. Run silent-print-on.reg as Administrator, then restart Chrome.'
}

Write-Output ''
Write-Output '=== 6. WINDOWS ======================================================'
$os = Get-CimInstance Win32_OperatingSystem
Write-Output ('  ' + $os.Caption + '  build ' + $os.BuildNumber + '  (' + $os.OSArchitecture + ')')
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
         ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) { Write-Output '  Running as Administrator : YES' }
else { Write-Output '  Running as Administrator : NO (fine for this script)' }
Write-Output ''
Write-Output 'Done. Copy everything above back into the chat.'
