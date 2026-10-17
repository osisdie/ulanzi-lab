# Select the first Windows Terminal tab whose title contains -Match (UI Automation). Exit 0 if found.
param([Parameter(Mandatory)][string[]]$Match)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::RootElement
$winCond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'CASCADIA_HOSTING_WINDOW_CLASS')
$tabCond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
foreach ($w in $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond)) {
    foreach ($t in $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCond)) {
        foreach ($m in $Match) {
            if ($m -and $t.Current.Name -like "*$m*") {
                $t.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
                Write-Output "$($w.Current.NativeWindowHandle)`t$($t.Current.Name)"
                exit 0
            }
        }
    }
}
exit 1
