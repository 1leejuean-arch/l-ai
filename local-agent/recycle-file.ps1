$ErrorActionPreference = "Stop"

$targetPath = [Environment]::GetEnvironmentVariable("L_AI_RECYCLE_TARGET")

if ([string]::IsNullOrWhiteSpace($targetPath)) {
  throw "Recycle target is missing."
}

Add-Type -AssemblyName Microsoft.VisualBasic

[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
  $targetPath,
  [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
  [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin,
  [Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException
)
