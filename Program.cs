using Microsoft.AspNetCore.Components.WebAssembly.Hosting;
using Microsoft.Extensions.DependencyInjection;
using System;
using System.Net.Http;
using Microsoft.AspNetCore.Components.Web;
using UltraDES;
using UltraDESWeb;
using UltraDESWeb.Services;


DeterministicFiniteAutomaton.Multicore = false;
var builder = WebAssemblyHostBuilder.CreateDefault(args);
builder.RootComponents.Add<App>("app");
builder.RootComponents.Add<HeadOutlet>("head::after");

builder.Services.AddScoped(sp => new HttpClient { BaseAddress = new Uri(builder.HostEnvironment.BaseAddress) });
builder.Services.AddScoped<WorkspaceStorage>();
builder.Services.AddScoped<AutomatonDraftValidator>();
builder.Services.AddScoped<AutomatonLayoutService>();

await builder.Build().RunAsync();
