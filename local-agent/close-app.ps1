$ErrorActionPreference = "Stop"

$processNames = @(
  $env:L_AI_APP_PROCESS_NAMES.Split(",") |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
)

if ($processNames.Count -eq 0) {
  throw "No process aliases were provided."
}

$processes = @(Get-Process -Name $processNames -ErrorAction SilentlyContinue)
$windowProcesses = @(
  $processes | Where-Object { $_.MainWindowHandle -ne 0 }
)
$targetIds = @($windowProcesses | ForEach-Object { $_.Id })
$closeRequested = $false

foreach ($target in $windowProcesses) {
  try {
    if ($target.CloseMainWindow()) {
      $closeRequested = $true
    }
  } catch {}
}

$remainingIds = @($targetIds)
if ($targetIds.Count -gt 0) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds(1500)

  do {
    $remainingIds = @(
      foreach ($processId in $targetIds) {
        $candidate = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if (
          $null -ne $candidate -and
          $processNames -contains $candidate.ProcessName -and
          $candidate.MainWindowHandle -ne 0
        ) {
          $processId
        }
      }
    )

    if ($remainingIds.Count -eq 0) {
      break
    }

    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $deadline)
}

[pscustomobject]@{
  processFound = $processes.Count -gt 0
  windowFound = $windowProcesses.Count -gt 0
  closeRequested = $closeRequested
  stillRunning = $remainingIds.Count -gt 0
} | ConvertTo-Json -Compress
