$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class LaiCalculatorWindowApi
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetClassNameW(IntPtr hWnd, StringBuilder className, int count);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessageW(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
"@

function Get-WindowTitle([IntPtr]$WindowHandle) {
  $length = [LaiCalculatorWindowApi]::GetWindowTextLengthW($WindowHandle)
  $builder = [System.Text.StringBuilder]::new($length + 1)
  [void][LaiCalculatorWindowApi]::GetWindowTextW(
    $WindowHandle,
    $builder,
    $builder.Capacity
  )
  return $builder.ToString()
}

function Get-WindowClass([IntPtr]$WindowHandle) {
  $builder = [System.Text.StringBuilder]::new(256)
  [void][LaiCalculatorWindowApi]::GetClassNameW(
    $WindowHandle,
    $builder,
    $builder.Capacity
  )
  return $builder.ToString()
}

function Test-CalculatorFrameWindow([IntPtr]$WindowHandle) {
  if (
    -not [LaiCalculatorWindowApi]::IsWindow($WindowHandle) -or
    -not [LaiCalculatorWindowApi]::IsWindowVisible($WindowHandle)
  ) {
    return $false
  }

  if ((Get-WindowClass $WindowHandle) -cne "ApplicationFrameWindow") {
    return $false
  }

  $title = Get-WindowTitle $WindowHandle
  $normalizedTitle = $title.Normalize([Text.NormalizationForm]::FormKC).Trim().ToLowerInvariant()
  $normalizedTitle = [regex]::Replace($normalizedTitle, "\s+", " ")

  $koreanTitle = -join @([char]0xACC4, [char]0xC0B0, [char]0xAE30)
  if ($normalizedTitle -eq $koreanTitle) {
    return $true
  }

  if ($normalizedTitle -eq "calculator") {
    return $true
  }

  return $false
}

function Get-TopLevelWindowHandles {
  $handles = [System.Collections.Generic.List[IntPtr]]::new()
  $callback = [LaiCalculatorWindowApi+EnumWindowsProc]{
    param([IntPtr]$windowHandle, [IntPtr]$parameter)
    [void]$handles.Add($windowHandle)
    return $true
  }

  [void][LaiCalculatorWindowApi]::EnumWindows($callback, [IntPtr]::Zero)
  return $handles
}

$action = $env:L_AI_CALCULATOR_WINDOW_ACTION

if ($action -eq "enumerate") {
  $windows = @(
    Get-TopLevelWindowHandles | ForEach-Object {
      $windowHandle = $_
      [pscustomobject]@{
      hwnd = "0x$($windowHandle.ToInt64().ToString('X'))"
      visible = [LaiCalculatorWindowApi]::IsWindowVisible($windowHandle)
      title = Get-WindowTitle $windowHandle
      className = Get-WindowClass $windowHandle
      }
    }
  )

  ConvertTo-Json -InputObject @($windows) -Compress
  exit 0
}

if ($action -eq "close") {
  $targetHandles = @(
    Get-TopLevelWindowHandles |
      Where-Object { Test-CalculatorFrameWindow $_ }
  )

  if ($targetHandles.Count -eq 0) {
    [pscustomobject]@{ status = "not_running" } |
      ConvertTo-Json -Compress
    exit 0
  }

  $closeRequested = $false
  foreach ($windowHandle in $targetHandles) {
    if (
      [LaiCalculatorWindowApi]::PostMessageW(
        $windowHandle,
        0x0010,
        [IntPtr]::Zero,
        [IntPtr]::Zero
      )
    ) {
      $closeRequested = $true
    }
  }

  if (-not $closeRequested) {
    [pscustomobject]@{
      status = "failed"
      reason = "close_request_failed"
    } | ConvertTo-Json -Compress
    exit 0
  }

  $targetValues = [System.Collections.Generic.HashSet[Int64]]::new()
  foreach ($windowHandle in $targetHandles) {
    [void]$targetValues.Add($windowHandle.ToInt64())
  }

  $deadline = [DateTime]::UtcNow.AddMilliseconds(1500)
  do {
    $stillOpen = @(
      Get-TopLevelWindowHandles |
        Where-Object { $targetValues.Contains($_.ToInt64()) }
    )

    if ($stillOpen.Count -eq 0) {
      [pscustomobject]@{ status = "success" } |
        ConvertTo-Json -Compress
      exit 0
    }

    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)

  [pscustomobject]@{
    status = "failed"
    reason = "window_still_open"
  } | ConvertTo-Json -Compress
  exit 0
}

throw "Unsupported calculator window action."
