param(
    [string]$InputPath,
    [string]$OutputPath
)

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = [Microsoft.Office.Interop.Word.WdAlertLevel]::wdAlertsNone

try {
    $doc = $word.Documents.Open($InputPath, $false, $true)
    # wdFormatXMLDocument = 12 (.docx)
    $doc.SaveAs2($OutputPath, 12)
    $doc.Close($false)
    Write-Host "SUCCESS: Converted $InputPath to $OutputPath"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
} finally {
    $word.Quit()
}
