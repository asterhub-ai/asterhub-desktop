using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class AsterHubLauncher
{
    private const string RuntimeName = "AsterHub.Runtime.exe";
    private const string CheckArgument = "--asterhub-launcher-check";

    [STAThread]
    private static int Main(string[] args)
    {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        string runtimePath = Path.Combine(directory, RuntimeName);
        if (args.Length == 1 && args[0] == CheckArgument)
            return File.Exists(runtimePath) ? 0 : 2;

        if (!File.Exists(runtimePath))
        {
            MessageBox.Show("未找到 AsterHub 运行文件，请重新安装应用。", "AsterHub",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 2;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = runtimePath,
                Arguments = JoinArguments(args),
                WorkingDirectory = directory,
                UseShellExecute = false,
            });
            return 0;
        }
        catch
        {
            MessageBox.Show("AsterHub 启动失败，请重试或重新安装应用。", "AsterHub",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static string JoinArguments(string[] args)
    {
        var result = new StringBuilder();
        for (int index = 0; index < args.Length; index++)
        {
            if (index > 0) result.Append(' ');
            result.Append(QuoteArgument(args[index]));
        }
        return result.ToString();
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1).Append('"');
                slashes = 0;
                continue;
            }
            result.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }
}
