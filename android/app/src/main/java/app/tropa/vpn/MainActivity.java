package app.tropa.vpn;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // наш мост к Android (VPN, шифрование, камера) — до запуска окна
        registerPlugin(TropaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
