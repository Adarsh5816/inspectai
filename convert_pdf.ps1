param(
    [string]$InputPath,
    [string]$OutputPath
)

$word = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    $doc = $word.Documents.Open($InputPath, $false, $true)
    # wdFormatPDF = 17
    $doc.SaveAs2($OutputPath, 17)
    $doc.Close($false)
    Write-Host "SUCCESS: Converted $InputPath to $OutputPath"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    exit 1
} finally {
    if ($word -ne $null) {
        $word.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
    }
}
