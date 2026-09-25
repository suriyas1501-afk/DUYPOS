# =====================================================================
#  open-drawer.ps1 - kick the cash drawer through the printer
#
#  Only needed if the printer driver has NO built-in
#  "open cash drawer before/after printing" option.
#  Try the driver setting first - it costs zero code.
#
#  Usage (get the exact name from check-setup.ps1):
#      powershell -ExecutionPolicy Bypass -File .\open-drawer.ps1 -PrinterName "POS-80C"
#
#  Star printers: add  -Star
#  Drawer #2 (5-pin) instead of #1 (2-pin): add  -Drawer2
#
#  Sends the bytes straight to the existing Windows print queue, so the
#  printer driver stays installed and A4 / tax-invoice printing is unaffected.
#  ASCII only on purpose - Thai text breaks in some PowerShell consoles.
# =====================================================================

param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [switch]$Star,
    [switch]$Drawer2
)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class PosRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static string Send(string printer, byte[] bytes, string dataType) {
        IntPtr h = IntPtr.Zero;
        int written = 0;
        if (!OpenPrinter(printer, out h, IntPtr.Zero))
            return "OpenPrinter failed (win32 error " + Marshal.GetLastWin32Error() + ") - check the printer name";

        DOCINFOA di = new DOCINFOA();
        di.pDocName = "POS Open Drawer";
        di.pDataType = dataType;

        string result = "unknown failure";
        if (StartDocPrinter(h, 1, ref di)) {
            if (StartPagePrinter(h)) {
                IntPtr p = Marshal.AllocCoTaskMem(bytes.Length);
                Marshal.Copy(bytes, 0, p, bytes.Length);
                bool ok = WritePrinter(h, p, bytes.Length, out written);
                Marshal.FreeCoTaskMem(p);
                result = ok
                    ? "OK - wrote " + written + " bytes as " + dataType
                    : "WritePrinter failed (win32 error " + Marshal.GetLastWin32Error() + ")";
                EndPagePrinter(h);
            } else {
                result = "StartPagePrinter failed (win32 error " + Marshal.GetLastWin32Error() + ")";
            }
            EndDocPrinter(h);
        } else {
            result = "StartDocPrinter failed (win32 error " + Marshal.GetLastWin32Error() + ")";
        }
        ClosePrinter(h);
        return result;
    }
}
'@

# --- make sure the queue exists ---------------------------------------
try {
    $printer = Get-Printer -Name $PrinterName -ErrorAction Stop
} catch {
    Write-Output ("Printer not found: " + $PrinterName)
    Write-Output 'Available printers:'
    Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object { Write-Output ('  ' + $_) }
    exit 1
}

# --- v4 drivers silently discard RAW data, they need XPS_PASS ----------
$dataType = 'RAW'
try {
    $drv = Get-PrinterDriver -Name $printer.DriverName -ErrorAction Stop
    if ($drv.MajorVersion -eq 4) { $dataType = 'XPS_PASS' }
} catch {
    Write-Output ('  (could not read driver version, assuming RAW: ' + $_.Exception.Message + ')')
}

# --- the kick bytes ---------------------------------------------------
if ($Star) {
    # Star printers open the drawer on BEL
    $kick = [byte[]](0x07)
    $what = 'BEL (Star)'
} elseif ($Drawer2) {
    # ESC p 1 25 250  -> drawer #2 (5-pin), 50ms on / 500ms off
    $kick = [byte[]](0x1B, 0x70, 0x01, 0x19, 0xFA)
    $what = 'ESC p 1 25 250 (drawer #2)'
} else {
    # ESC p 0 25 250  -> drawer #1 (2-pin), 50ms on / 500ms off
    $kick = [byte[]](0x1B, 0x70, 0x00, 0x19, 0xFA)
    $what = 'ESC p 0 25 250 (drawer #1)'
}

Write-Output ('Printer  : ' + $printer.Name + '  [' + $printer.DriverName + ' / ' + $printer.PortName + ']')
Write-Output ('Command  : ' + $what)
Write-Output ('DataType : ' + $dataType)
Write-Output ('Result   : ' + [PosRawPrinter]::Send($printer.Name, $kick, $dataType))
Write-Output ''
Write-Output 'If it says OK but nothing happened, try in this order:'
Write-Output '  1. -Drawer2        (drawer wired to the 5-pin port)'
Write-Output '  2. -Star           (Star printers use BEL instead of ESC p)'
Write-Output '  3. Check the drawer cable is in the printer DK/DRAWER port, not the network port'
Write-Output '  4. Check the print queue is not paused / offline'
